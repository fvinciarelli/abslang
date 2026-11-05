using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AbsLang;

public sealed class ResponsesFunctionCall
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Arguments { get; set; } = "";
}

public sealed class ResponsesStreamState
{
    public string Text { get; set; } = "";
    public Dictionary<string, ResponsesFunctionCall> Calls { get; } = new(StringComparer.Ordinal);
    public List<string> Order { get; } = new();
    public Dictionary<string, object?>? Completed { get; set; }
}

/// <summary>
/// Executes an ABS session against an HTTP agent and returns the observed trace
/// plus all evaluation results.
/// </summary>
public sealed class AbsRunner
{
    private static readonly HashSet<string> CommunicationActions = new(StringComparer.Ordinal)
    {
        "says", "asks", "informs", "greets", "responds", "clarifies",
        "confirms", "rejects", "suggests", "shows", "hands_off",
    };

    private static readonly HashSet<string> ExecutionActions = new(StringComparer.Ordinal)
    {
        "calls", "submits", "retrieves", "stores", "updates",
    };

    private readonly HttpClient _http;

    public AbsRunner(HttpClient? httpClient = null)
    {
        _http = httpClient ?? new HttpClient();
    }

    public async Task<RunResult> RunAsync(
        NormalizedSession session,
        AgentConfig agent,
        IReadOnlyDictionary<string, object?>? rowVars = null,
        RunLogger? logger = null,
        CancellationToken cancellationToken = default)
    {
        var trace = new List<ObservedStep>();
        var stepResults = new List<StepResult>();
        var messages = new List<AgentMessage>();
        var skippedIds = new HashSet<string>(StringComparer.Ordinal);
        var stepNumber = 0;
        var turnStart = 0;
        var turnConsumed = 0;

        logger ??= new RunLogger();
        logger.Event("session.start", ("session", session.Session), ("behaviors", session.Behaviors.Count));

        async Task<EvalResult> EvaluateRuleAsync(
            Evaluation rule,
            ObservedStep? observed,
            Behavior? behavior,
            int? step)
        {
            var started = Stopwatch.GetTimestamp();
            var adapterResult = await AbsEvaluators
                .EvaluateWithAdapterAsync(rule.Type, trace, rule, rule.Adapter, cancellationToken)
                .ConfigureAwait(false);

            var result = adapterResult != null
                ? AbsEvaluators.ApplyThreshold(adapterResult, rule)
                : AbsEvaluators.ApplyThreshold(
                    AbsEvaluators.EvaluateStep(observed, rule, session.Behaviors, trace, behavior),
                    rule);

            result.DurationMs = ElapsedMilliseconds(started);
            logger!.Event("evaluation.result",
                ("step", step),
                ("evaluation_type", result.Type),
                ("adapter", result.Adapter),
                ("passed", result.Passed),
                ("score", result.Score),
                ("threshold", result.Threshold),
                ("code", result.Code),
                ("duration_ms", result.DurationMs),
                ("reason", logger.IncludeContent ? result.Reason : null));
            return result;
        }

        foreach (var behavior in session.Behaviors)
        {
            stepNumber++;

            // v0.2: skip behaviors whose dependency did not match.
            if (behavior.Requires != null && skippedIds.Contains(behavior.Requires))
            {
                if (behavior.Id != null) skippedIds.Add(behavior.Id);
                logger.Event("behavior.skipped", ("step", stepNumber), ("behavior_id", behavior.Id), ("reason", "requires"));
                stepResults.Add(new StepResult
                {
                    Step = stepNumber,
                    Behavior = behavior,
                    Skipped = true,
                });
                continue;
            }

            if (behavior.Actor == "user")
            {
                messages.Add(new AgentMessage
                {
                    Role = "user",
                    Content = ContentToString(behavior.Content),
                });

                trace.Add(new ObservedStep
                {
                    Actor = "user",
                    Action = behavior.Action,
                    Id = behavior.Id,
                    Target = behavior.Target,
                    Content = behavior.Content,
                    With = behavior.With,
                });

                turnStart = trace.Count;
                turnConsumed = 0;

                AgentResponse response;
                logger.Event("agent.request", ("step", stepNumber), ("messages", messages.Count));
                try
                {
                    response = await SendAsync(messages, agent, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception error)
                {
                    logger.Event("agent.error", ("step", stepNumber), ("error", error.Message));
                    stepResults.Add(new StepResult
                    {
                        Step = stepNumber,
                        Behavior = behavior,
                        Sent = true,
                    });
                    trace.Add(new ObservedStep
                    {
                        Actor = "error",
                        Action = "responds",
                        Content = $"Agent error: {error.Message}",
                    });
                    continue;
                }

                logger.Event("agent.response", ("step", stepNumber), ("new_messages", response.Messages.Count));

                foreach (var message in response.Messages)
                {
                    messages.Add(message);

                    if (message.ToolCalls is { Count: > 0 })
                    {
                        foreach (var toolCall in message.ToolCalls)
                        {
                            trace.Add(new ObservedStep
                            {
                                Actor = "assistant",
                                Action = "calls",
                                Target = toolCall.Function.Name,
                                With = JsonValues.Parse(toolCall.Function.Arguments) as Dictionary<string, object?>,
                                ToolCallId = toolCall.Id,
                            });
                        }
                        continue;
                    }

                    if (message.Role == "tool")
                    {
                        trace.Add(new ObservedStep
                        {
                            Actor = "tool",
                            Action = "responds",
                            Target = message.Name,
                            Content = JsonValues.Parse(message.Content ?? ""),
                            ToolCallId = message.ToolCallId,
                        });
                    }
                    else if (message.Role == "assistant")
                    {
                        trace.Add(new ObservedStep
                        {
                            Actor = "assistant",
                            Action = "responds",
                            Content = message.Content,
                        });
                    }
                }

                logger.Event("behavior.match", ("step", stepNumber), ("behavior_id", behavior.Id), ("matched", true), ("sent", true));
                stepResults.Add(new StepResult
                {
                    Step = stepNumber,
                    Behavior = behavior,
                    Sent = true,
                });
                continue;
            }

            if (behavior.Actor == "tool" && behavior.Action == "responds")
            {
                var lastAssistant = messages.LastOrDefault(m => m.Role == "assistant" && m.ToolCalls is { Count: > 0 });
                if (lastAssistant?.ToolCalls != null)
                {
                    foreach (var toolCall in lastAssistant.ToolCalls)
                    {
                        messages.Add(new AgentMessage
                        {
                            Role = "tool",
                            ToolCallId = toolCall.Id,
                            Name = toolCall.Function.Name,
                            Content = ContentToString(behavior.Content),
                        });
                    }
                }

                trace.Add(new ObservedStep
                {
                    Actor = "tool",
                    Action = "responds",
                    Id = behavior.Id,
                    Target = behavior.Target,
                    Content = behavior.Content,
                });
                turnConsumed++;

                AgentResponse response;
                logger.Event("agent.request", ("step", stepNumber), ("messages", messages.Count));
                try
                {
                    response = await SendAsync(messages, agent, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception error)
                {
                    logger.Event("agent.error", ("step", stepNumber), ("error", error.Message));
                    stepResults.Add(new StepResult
                    {
                        Step = stepNumber,
                        Behavior = behavior,
                    });
                    continue;
                }

                foreach (var message in response.Messages)
                {
                    messages.Add(message);
                    if (message.Role == "assistant" && message.Content != null)
                    {
                        trace.Add(new ObservedStep
                        {
                            Actor = "assistant",
                            Action = "responds",
                            Content = message.Content,
                        });
                    }
                }

                var observedTool = new ObservedStep
                {
                    Actor = "tool",
                    Action = "responds",
                    Target = behavior.Target,
                    Content = behavior.Content,
                };
                var toolEvaluations = new List<EvalResult>();
                if (behavior.Evaluations != null)
                {
                    foreach (var rule in behavior.Evaluations)
                    {
                        toolEvaluations.Add(await EvaluateRuleAsync(rule, observedTool, behavior, stepNumber).ConfigureAwait(false));
                    }
                }

                logger.Event("behavior.match", ("step", stepNumber), ("behavior_id", behavior.Id), ("matched", true));
                stepResults.Add(new StepResult
                {
                    Step = stepNumber,
                    Behavior = behavior,
                    Observed = observedTool,
                    Matched = true,
                    Evaluations = toolEvaluations,
                });
                continue;
            }

            // Assistant expectation: match against the current turn's observed steps.
            var observed = turnStart + turnConsumed < trace.Count ? trace[turnStart + turnConsumed] : null;
            var matched = await MatchesAsync(behavior, observed, trace, cancellationToken).ConfigureAwait(false);

            if (behavior.Optional && !matched)
            {
                if (behavior.Id != null) skippedIds.Add(behavior.Id);
                logger.Event("behavior.skipped", ("step", stepNumber), ("behavior_id", behavior.Id), ("reason", "optional"));
                stepResults.Add(new StepResult
                {
                    Step = stepNumber,
                    Behavior = behavior,
                    Observed = observed,
                    Matched = false,
                    Skipped = true,
                });
                continue;
            }

            if (!behavior.Optional) turnConsumed++;

            var matchObserved = matched ? observed : null;
            if (matched && observed != null)
            {
                if (behavior.Id != null) observed.Id = behavior.Id;
                if (observed.Action == "responds" && CommunicationActions.Contains(behavior.Action))
                {
                    observed.Action = behavior.Action;
                }
            }

            logger.Event("behavior.match", ("step", stepNumber), ("behavior_id", behavior.Id), ("matched", matched));

            var evaluations = new List<EvalResult>();
            if (behavior.Evaluations != null)
            {
                foreach (var rule in behavior.Evaluations)
                {
                    evaluations.Add(await EvaluateRuleAsync(rule, matchObserved, behavior, stepNumber).ConfigureAwait(false));
                }
            }

            stepResults.Add(new StepResult
            {
                Step = stepNumber,
                Behavior = behavior,
                Observed = matchObserved,
                Matched = matched,
                Evaluations = evaluations,
            });
        }

        // Session-level (chain) evaluations.
        var chainEvaluations = new List<EvalResult>();
        foreach (var rule in session.Evaluations ?? new List<Evaluation>())
        {
            if (rule.Type == "expected")
            {
                chainEvaluations.Add(AbsEvaluators.Expected(stepResults, rule, rowVars ?? new Dictionary<string, object?>()));
                continue;
            }

            if (rule.Type == "never" && rule.GetString("when") is { } when &&
                !AbsEvaluators.EvalWhen(when, rowVars ?? new Dictionary<string, object?>()))
            {
                chainEvaluations.Add(new EvalResult
                {
                    Type = "never",
                    Passed = true,
                    Score = 1,
                    Reason = "when condition not met — skipped",
                });
                continue;
            }

            chainEvaluations.Add(await EvaluateRuleAsync(rule, null, null, null).ConfigureAwait(false));
        }

        PropagateBlocking(stepResults);

        var allEvaluations = stepResults.SelectMany(step => step.Evaluations)
            .Concat(chainEvaluations)
            .ToList();

        var result = new RunResult
        {
            Session = session.Session,
            Agent = agent.Url,
            Passed = allEvaluations.All(evaluation => evaluation.Passed || evaluation.Inconclusive),
            Steps = stepResults,
            ChainEvaluations = chainEvaluations,
            StepsTotal = stepResults.Count,
            StepsMatched = stepResults.Count(step => step.Matched || step.Sent),
            EvaluationsTotal = allEvaluations.Count,
            EvaluationsPassed = allEvaluations.Count(evaluation => evaluation.Passed || evaluation.Inconclusive),
        };

        logger.Event("session.end", ("passed", result.Passed), ("steps_total", result.StepsTotal), ("evaluations_total", result.EvaluationsTotal));
        return result;
    }

    // ── Matching ────────────────────────────────────────────────────────────

    private async Task<bool> MatchesAsync(
        Behavior behavior,
        ObservedStep? observed,
        IReadOnlyList<ObservedStep> trace,
        CancellationToken cancellationToken)
    {
        if (behavior.MatchesWhen != null)
        {
            if (observed == null) return false;
            var text = ToText(observed.Content);
            switch (behavior.MatchesWhen.Type)
            {
                case "contains":
                    return behavior.MatchesWhen.Value != null &&
                           text.IndexOf(behavior.MatchesWhen.Value, StringComparison.Ordinal) >= 0;
                case "regex":
                    return behavior.MatchesWhen.Pattern != null && Regex.IsMatch(text, behavior.MatchesWhen.Pattern);
                case "llm_judge":
                {
                    var rule = new Evaluation { Type = "llm_judge" };
                    rule.Data["criteria"] = behavior.MatchesWhen.Criteria ?? "";
                    var result = await AbsEvaluators
                        .EvaluateWithAdapterAsync("llm_judge", trace, rule, null, cancellationToken)
                        .ConfigureAwait(false);
                    return result?.Passed ?? false;
                }
                default:
                    return false;
            }
        }

        if (observed == null) return false;
        if (observed.Actor != behavior.Actor) return false;

        var actionMatches = observed.Action == behavior.Action ||
                            (CommunicationActions.Contains(observed.Action) && CommunicationActions.Contains(behavior.Action)) ||
                            (ExecutionActions.Contains(observed.Action) && ExecutionActions.Contains(behavior.Action));
        if (!actionMatches) return false;

        if (!CommunicationActions.Contains(behavior.Action) &&
            behavior.Target != null &&
            observed.Target != behavior.Target)
        {
            return false;
        }

        return MatchesParams(behavior, observed);
    }

    private static bool MatchesParams(Behavior behavior, ObservedStep observed)
    {
        if (behavior.With == null && behavior.WithOnly == null) return true;

        var observedWith = observed.With ?? new Dictionary<string, object?>(StringComparer.Ordinal);

        if (behavior.WithOnly != null)
        {
            if (behavior.WithOnly.Count != observedWith.Count) return false;
            foreach (var pair in behavior.WithOnly)
            {
                if (!observedWith.TryGetValue(pair.Key, out var value)) return false;
                if (!AbsValues.DeepEquals(value, pair.Value)) return false;
            }
            return true;
        }

        foreach (var pair in behavior.With!)
        {
            if (!observedWith.TryGetValue(pair.Key, out var value)) return false;
            if (!AbsValues.DeepEquals(value, pair.Value)) return false;
        }
        return true;
    }

    private static void PropagateBlocking(IReadOnlyList<StepResult> stepResults)
    {
        var downstreamBlocked = false;
        foreach (var step in stepResults)
        {
            foreach (var evaluation in step.Evaluations)
            {
                if (downstreamBlocked)
                {
                    evaluation.Inconclusive = true;
                    evaluation.Reason = "Inconclusive: a blocking evaluation earlier in the session failed.";
                }
                else if (evaluation.Blocking && !evaluation.Passed)
                {
                    downstreamBlocked = true;
                }
            }
        }
    }

    // ── Agent protocols ─────────────────────────────────────────────────────

    private async Task<AgentResponse> SendAsync(
        IReadOnlyList<AgentMessage> messages,
        AgentConfig config,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.Url))
        {
            throw new AbsException("Agent URL is required.");
        }

        var effective = await ResolveOAuthAsync(config, cancellationToken).ConfigureAwait(false);

        return effective.Format switch
        {
            "openai" or "custom" => await SendOpenAiAsync(messages, effective, cancellationToken).ConfigureAwait(false),
            "responses" or "response" => await SendResponsesAsync(messages, effective, cancellationToken).ConfigureAwait(false),
            "claude" => await SendClaudeAsync(messages, effective, cancellationToken).ConfigureAwait(false),
            "gemini" => await SendGeminiAsync(messages, effective, cancellationToken).ConfigureAwait(false),
            _ => throw new AbsException($"Unknown agent format: {effective.Format}"),
        };
    }

    private async Task<AgentConfig> ResolveOAuthAsync(AgentConfig config, CancellationToken cancellationToken)
    {
        if (config.Auth != "oauth2" ||
            string.IsNullOrEmpty(config.RefreshUrl) ||
            string.IsNullOrEmpty(config.RefreshToken))
        {
            return config;
        }

        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = config.RefreshToken!,
        };
        if (!string.IsNullOrEmpty(config.ClientId)) form["client_id"] = config.ClientId!;

        using var request = new HttpRequestMessage(HttpMethod.Post, config.RefreshUrl)
        {
            Content = new FormUrlEncodedContent(form),
        };

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new AbsException($"OAuth2 token refresh failed ({(int)response.StatusCode}): {Preview(text)}");
        }

        using var document = JsonDocument.Parse(text);
        if (!document.RootElement.TryGetProperty("access_token", out var accessToken))
        {
            throw new AbsException("OAuth2 token refresh response did not include access_token.");
        }

        return WithToken(config, accessToken.GetString());
    }

    private static AgentConfig WithToken(AgentConfig source, string? token) => new()
    {
        Url = source.Url,
        Format = source.Format,
        Auth = source.Auth,
        Token = token ?? source.Token,
        Model = source.Model,
        ForwardAuth = source.ForwardAuth,
        Authorization = source.Authorization,
        RefreshUrl = source.RefreshUrl,
        RefreshToken = source.RefreshToken,
        ClientId = source.ClientId,
        Stream = source.Stream,
        TimeoutSeconds = source.TimeoutSeconds,
    };

    // ── OpenAI-compatible ───────────────────────────────────────────────────

    private async Task<AgentResponse> SendOpenAiAsync(
        IReadOnlyList<AgentMessage> messages,
        AgentConfig config,
        CancellationToken cancellationToken)
    {
        if (config.Stream == true)
        {
            return await SendOpenAiStreamAsync(messages, config, cancellationToken).ConfigureAwait(false);
        }

        var body = new Dictionary<string, object?>
        {
            ["messages"] = messages.Select(MessageToDictionary).ToList(),
            ["tools"] = new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["type"] = "function",
                    ["function"] = new Dictionary<string, object?>
                    {
                        ["name"] = "any",
                        ["description"] = "Tool",
                        ["parameters"] = new Dictionary<string, object?>(),
                    },
                },
            },
            ["tool_choice"] = "auto",
        };

        using var request = BuildRequest(config.Url, body, config);
        using var timeout = CreateTimeout(config.TimeoutSeconds, cancellationToken);
        using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AbsException($"Agent returned {(int)response.StatusCode}: {Preview(text)}");
        }

        return ParseOpenAiResponse(text);
    }

    private async Task<AgentResponse> SendOpenAiStreamAsync(
        IReadOnlyList<AgentMessage> messages,
        AgentConfig config,
        CancellationToken cancellationToken)
    {
        var body = new Dictionary<string, object?>
        {
            ["messages"] = messages.Select(MessageToDictionary).ToList(),
            ["tools"] = new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["type"] = "function",
                    ["function"] = new Dictionary<string, object?>
                    {
                        ["name"] = "any",
                        ["description"] = "Tool",
                        ["parameters"] = new Dictionary<string, object?>(),
                    },
                },
            },
            ["tool_choice"] = "auto",
            ["stream"] = true,
        };

        using var request = BuildRequest(config.Url, body, config);
        using var timeout = CreateTimeout(config.TimeoutSeconds, cancellationToken);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var errorText = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            throw new AbsException($"Agent returned {(int)response.StatusCode}: {Preview(errorText)}");
        }

        using var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
        using var reader = new StreamReader(stream);
        var content = "";
        var calls = new Dictionary<int, ToolCall>();

        string? line;
        while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line.Substring(5).Trim();
            if (data == "[DONE]") break;
            try
            {
                using var document = JsonDocument.Parse(data);
                var root = document.RootElement;
                if (!root.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0) continue;
                if (!choices[0].TryGetProperty("delta", out var delta)) continue;
                if (delta.TryGetProperty("content", out var deltaContent) && deltaContent.ValueKind == JsonValueKind.String)
                {
                    content += deltaContent.GetString();
                }
                if (delta.TryGetProperty("tool_calls", out var toolCalls) && toolCalls.ValueKind == JsonValueKind.Array)
                {
                    foreach (var call in toolCalls.EnumerateArray())
                    {
                        var index = call.TryGetProperty("index", out var indexValue) ? indexValue.GetInt32() : 0;
                        if (!calls.TryGetValue(index, out var existing))
                        {
                            existing = new ToolCall
                            {
                                Id = "",
                                Function = new ToolCallFunction { Name = "", Arguments = "" },
                            };
                            calls[index] = existing;
                        }
                        if (call.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                            existing.Id = id.GetString() ?? "";
                        if (call.TryGetProperty("function", out var function))
                        {
                            if (function.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
                                existing.Function.Name += name.GetString();
                            if (function.TryGetProperty("arguments", out var arguments) && arguments.ValueKind == JsonValueKind.String)
                                existing.Function.Arguments += arguments.GetString();
                        }
                    }
                }
            }
            catch (JsonException)
            {
                // partial chunk — ignore
            }
        }

        var message = new AgentMessage { Role = "assistant", Content = content.Length > 0 ? content : null };
        if (calls.Count > 0) message.ToolCalls = calls.OrderBy(pair => pair.Key).Select(pair => pair.Value).ToList();
        return new AgentResponse { Messages = new List<AgentMessage> { message }, Raw = new { streamed = true } };
    }

    private static Dictionary<string, object?> MessageToDictionary(AgentMessage message)
    {
        var result = new Dictionary<string, object?>
        {
            ["role"] = message.Role,
            ["content"] = message.Content,
        };

        if (message.ToolCalls is { Count: > 0 })
        {
            result["tool_calls"] = message.ToolCalls.Select(toolCall => new Dictionary<string, object?>
            {
                ["id"] = toolCall.Id,
                ["type"] = toolCall.Type,
                ["function"] = new Dictionary<string, object?>
                {
                    ["name"] = toolCall.Function.Name,
                    ["arguments"] = toolCall.Function.Arguments,
                },
            }).ToList();
        }

        if (message.ToolCallId != null) result["tool_call_id"] = message.ToolCallId;
        if (message.Name != null) result["name"] = message.Name;
        return result;
    }

    private static AgentResponse ParseOpenAiResponse(string text)
    {
        using var document = JsonDocument.Parse(text);
        var response = new AgentResponse { Raw = JsonValues.ToObject(document.RootElement) };

        if (!document.RootElement.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
        {
            return response;
        }

        var message = choices[0].GetProperty("message");
        var agentMessage = new AgentMessage
        {
            Role = message.TryGetProperty("role", out var role) && role.ValueKind == JsonValueKind.String
                ? role.GetString() ?? "assistant"
                : "assistant",
            Content = message.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.String
                ? content.GetString()
                : null,
        };

        if (message.TryGetProperty("tool_calls", out var toolCalls) && toolCalls.ValueKind == JsonValueKind.Array)
        {
            agentMessage.ToolCalls = new List<ToolCall>();
            foreach (var call in toolCalls.EnumerateArray())
            {
                var function = call.GetProperty("function");
                agentMessage.ToolCalls.Add(new ToolCall
                {
                    Id = call.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                    Type = call.TryGetProperty("type", out var type) ? type.GetString() ?? "function" : "function",
                    Function = new ToolCallFunction
                    {
                        Name = function.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "",
                        Arguments = function.TryGetProperty("arguments", out var arguments) ? arguments.GetString() ?? "" : "",
                    },
                });
            }
        }

        response.Messages.Add(agentMessage);
        return response;
    }

    // ── OpenAI Responses API ────────────────────────────────────────────────

    public static (string? Instructions, List<object?> Input) ToResponsesInput(
        IReadOnlyList<AgentMessage> messages)
    {
        var instructions = new List<string>();
        var input = new List<object?>();

        foreach (var message in messages)
        {
            if (message.Role == "system")
            {
                if (!string.IsNullOrEmpty(message.Content)) instructions.Add(message.Content!);
                continue;
            }

            if (message.Role == "tool")
            {
                input.Add(new Dictionary<string, object?>
                {
                    ["type"] = "function_call_output",
                    ["call_id"] = message.ToolCallId ?? "",
                    ["output"] = message.Content ?? "",
                });
                continue;
            }

            if (message.Role == "assistant" && message.ToolCalls is { Count: > 0 })
            {
                if (!string.IsNullOrEmpty(message.Content))
                {
                    input.Add(new Dictionary<string, object?> { ["role"] = "assistant", ["content"] = message.Content });
                }
                foreach (var toolCall in message.ToolCalls)
                {
                    input.Add(new Dictionary<string, object?>
                    {
                        ["type"] = "function_call",
                        ["call_id"] = toolCall.Id,
                        ["name"] = toolCall.Function.Name,
                        ["arguments"] = toolCall.Function.Arguments,
                    });
                }
                continue;
            }

            input.Add(new Dictionary<string, object?>
            {
                ["role"] = message.Role,
                ["content"] = message.Content ?? "",
            });
        }

        return (instructions.Count > 0 ? string.Join("\n\n", instructions) : null, input);
    }

    public static (string Content, List<ToolCall> ToolCalls) ParseResponsesOutput(object? output)
    {
        var texts = new List<string>();
        var toolCalls = new List<ToolCall>();

        if (output is not IEnumerable<object?> items) return ("", toolCalls);

        foreach (var item in items)
        {
            if (item is not Dictionary<string, object?> map) continue;
            var type = map.TryGetValue("type", out var typeValue) ? typeValue?.ToString() : null;

            if (type == "message" && map.TryGetValue("content", out var content) && content is IEnumerable<object?> parts)
            {
                foreach (var part in parts)
                {
                    if (part is not Dictionary<string, object?> partMap) continue;
                    var partType = partMap.TryGetValue("type", out var partTypeValue) ? partTypeValue?.ToString() : null;
                    if (partType == "output_text" && partMap.TryGetValue("text", out var text) && text != null)
                        texts.Add(text.ToString()!);
                    if (partType == "refusal" && partMap.TryGetValue("refusal", out var refusal) && refusal != null)
                        texts.Add(refusal.ToString()!);
                }
            }
            else if (type == "function_call")
            {
                var id = map.TryGetValue("call_id", out var callId) ? callId?.ToString()
                    : map.TryGetValue("id", out var itemId) ? itemId?.ToString() : "";
                toolCalls.Add(new ToolCall
                {
                    Id = id ?? "",
                    Function = new ToolCallFunction
                    {
                        Name = map.TryGetValue("name", out var name) ? name?.ToString() ?? "" : "",
                        Arguments = map.TryGetValue("arguments", out var arguments)
                            ? (arguments is string text ? text : AbsValues.Stringify(arguments))
                            : "{}",
                    },
                });
            }
        }

        return (string.Concat(texts), toolCalls);
    }

    public static void ApplyResponsesEvent(ResponsesStreamState state, Dictionary<string, object?> ev)
    {
        var type = ev.TryGetValue("type", out var typeValue) ? typeValue?.ToString() : null;
        switch (type)
        {
            case "response.output_text.delta":
            {
                if (ev.TryGetValue("delta", out var delta) && delta is string deltaText) state.Text += deltaText;
                break;
            }

            case "response.output_item.added":
            {
                if (ev.TryGetValue("item", out var itemValue) && itemValue is Dictionary<string, object?> item &&
                    item.TryGetValue("type", out var itemType) && itemType?.ToString() == "function_call")
                {
                    var key = item.TryGetValue("id", out var id) ? id?.ToString()
                        : ev.TryGetValue("output_index", out var outputIndex) ? outputIndex?.ToString()
                        : state.Order.Count.ToString();
                    key ??= state.Order.Count.ToString();
                    if (!state.Calls.ContainsKey(key))
                    {
                        state.Calls[key] = new ResponsesFunctionCall
                        {
                            Id = item.TryGetValue("call_id", out var callId) ? callId?.ToString() ?? ""
                                : item.TryGetValue("id", out var itemId) ? itemId?.ToString() ?? "" : "",
                            Name = item.TryGetValue("name", out var name) ? name?.ToString() ?? "" : "",
                            Arguments = item.TryGetValue("arguments", out var arguments) ? arguments?.ToString() ?? "" : "",
                        };
                        state.Order.Add(key);
                    }
                }
                break;
            }

            case "response.function_call_arguments.delta":
            {
                var key = (ev.TryGetValue("item_id", out var itemId) ? itemId?.ToString()
                    : ev.TryGetValue("output_index", out var outputIndex) ? outputIndex?.ToString() : null) ?? "";
                if (state.Calls.TryGetValue(key, out var call) && ev.TryGetValue("delta", out var delta) && delta is string deltaText)
                    call.Arguments += deltaText;
                break;
            }

            case "response.function_call_arguments.done":
            {
                var key = (ev.TryGetValue("item_id", out var itemId) ? itemId?.ToString()
                    : ev.TryGetValue("output_index", out var outputIndex) ? outputIndex?.ToString() : null) ?? "";
                if (state.Calls.TryGetValue(key, out var call) && ev.TryGetValue("arguments", out var arguments) && arguments is string argumentsText)
                    call.Arguments = argumentsText;
                break;
            }

            case "response.output_item.done":
            {
                if (ev.TryGetValue("item", out var itemValue) && itemValue is Dictionary<string, object?> item)
                {
                    if (item.TryGetValue("type", out var itemType) && itemType?.ToString() == "function_call")
                    {
                        var key = (item.TryGetValue("id", out var id) ? id?.ToString()
                            : ev.TryGetValue("output_index", out var outputIndex) ? outputIndex?.ToString() : null) ?? "";
                        if (!state.Calls.TryGetValue(key, out var call))
                        {
                            call = new ResponsesFunctionCall();
                            state.Calls[key] = call;
                            state.Order.Add(key);
                        }
                        call.Id = item.TryGetValue("call_id", out var callId) ? callId?.ToString() ?? call.Id
                            : item.TryGetValue("id", out var itemId) ? itemId?.ToString() ?? call.Id : call.Id;
                        call.Name = item.TryGetValue("name", out var name) ? name?.ToString() ?? call.Name : call.Name;
                        call.Arguments = item.TryGetValue("arguments", out var arguments) ? arguments?.ToString() ?? call.Arguments : call.Arguments;
                    }
                    else if ((item.TryGetValue("type", out var typeValue2) && typeValue2?.ToString() == "message") && state.Text.Length == 0)
                    {
                        var (content, _) = ParseResponsesOutput(new List<object?> { item });
                        if (content.Length > 0) state.Text = content;
                    }
                }
                break;
            }

            case "response.completed":
                state.Completed = ev.TryGetValue("response", out var response) ? response as Dictionary<string, object?> : null;
                break;

            case "error":
                throw new AbsException("Responses API error: " + AbsValues.Stringify(ev));
        }
    }

    public static AgentMessage ResponsesStateToMessage(ResponsesStreamState state)
    {
        var content = state.Text;
        var toolCalls = state.Order
            .Select(key => state.Calls.TryGetValue(key, out var call) ? call : null)
            .Where(call => call != null)
            .Select(call => new ToolCall
            {
                Id = call!.Id,
                Function = new ToolCallFunction { Name = call.Name, Arguments = call.Arguments },
            })
            .ToList();

        if (state.Completed != null)
        {
            state.Completed.TryGetValue("output", out var output);
            var (completedContent, completedCalls) = ParseResponsesOutput(output);
            if (completedContent.Length > 0 || completedCalls.Count > 0)
            {
                content = completedContent;
                toolCalls = completedCalls;
            }
        }

        var message = new AgentMessage { Role = "assistant", Content = content.Length > 0 ? content : null };
        if (toolCalls.Count > 0) message.ToolCalls = toolCalls;
        return message;
    }

    public static void ProcessResponsesSseLine(string line, ResponsesStreamState state)
    {
        var trimmed = line.Trim();
        if (!trimmed.StartsWith("data:", StringComparison.Ordinal)) return;
        var data = trimmed.Substring(5).Trim();
        if (data.Length == 0 || data == "[DONE]") return;
        try
        {
            var parsed = JsonValues.Parse(data);
            if (parsed is Dictionary<string, object?> map) ApplyResponsesEvent(state, map);
        }
        catch (JsonException)
        {
            // partial chunk — ignore
        }
    }

    private async Task<AgentResponse> SendResponsesAsync(
        IReadOnlyList<AgentMessage> messages,
        AgentConfig config,
        CancellationToken cancellationToken)
    {
        var (instructions, input) = ToResponsesInput(messages);
        var stream = config.Stream != false;

        var body = new Dictionary<string, object?>
        {
            ["input"] = input,
            ["tools"] = new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["type"] = "function",
                    ["name"] = "any",
                    ["description"] = "Tool",
                    ["parameters"] = new Dictionary<string, object?>
                    {
                        ["type"] = "object",
                        ["properties"] = new Dictionary<string, object?>(),
                    },
                },
            },
            ["tool_choice"] = "auto",
        };
        if (!string.IsNullOrEmpty(config.Model)) body["model"] = config.Model;
        if (!string.IsNullOrEmpty(instructions)) body["instructions"] = instructions;
        if (stream) body["stream"] = true;

        using var request = BuildRequest(config.Url, body, config);
        using var timeout = CreateTimeout(config.TimeoutSeconds, cancellationToken);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var errorText = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            throw new AbsException($"Agent returned {(int)response.StatusCode}: {Preview(errorText)}");
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType ?? "";
        var isEventStream = stream && mediaType.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) < 0;

        if (isEventStream)
        {
            using var streamReader = new StreamReader(await response.Content.ReadAsStreamAsync().ConfigureAwait(false));
            var state = new ResponsesStreamState();
            string? line;
            while ((line = await streamReader.ReadLineAsync().ConfigureAwait(false)) != null)
            {
                ProcessResponsesSseLine(line, state);
            }
            return new AgentResponse
            {
                Messages = new List<AgentMessage> { ResponsesStateToMessage(state) },
                Raw = new Dictionary<string, object?> { ["streamed"] = true, ["response"] = state.Completed },
            };
        }

        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        using var document = JsonDocument.Parse(text);
        var raw = JsonValues.ToObject(document.RootElement) as Dictionary<string, object?>;
        var output = raw != null && raw.TryGetValue("output", out var outputValue) ? outputValue : null;
        var (content, toolCalls) = ParseResponsesOutput(output);
        var message = new AgentMessage { Role = "assistant", Content = content.Length > 0 ? content : null };
        if (toolCalls.Count > 0) message.ToolCalls = toolCalls;
        return new AgentResponse { Messages = new List<AgentMessage> { message }, Raw = raw };
    }

    // ── Claude ──────────────────────────────────────────────────────────────

    private async Task<AgentResponse> SendClaudeAsync(
        IReadOnlyList<AgentMessage> messages,
        AgentConfig config,
        CancellationToken cancellationToken)
    {
        var system = messages.FirstOrDefault(message => message.Role == "system")?.Content;
        var chatMessages = messages.Where(message => message.Role != "system").Select(message => new Dictionary<string, object?>
        {
            ["role"] = message.Role == "assistant" ? "assistant" : "user",
            ["content"] = message.Content ?? "",
        }).ToList();

        var body = new Dictionary<string, object?>
        {
            ["model"] = string.IsNullOrEmpty(config.Model) ? "claude-sonnet-4-20250514" : config.Model,
            ["max_tokens"] = 1024,
            ["messages"] = chatMessages,
        };
        if (!string.IsNullOrEmpty(system)) body["system"] = system;

        using var request = BuildRequest(config.Url, body, config);
        request.Headers.TryAddWithoutValidation("x-api-key", config.Token ?? "");
        request.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
        using var timeout = CreateTimeout(config.TimeoutSeconds, cancellationToken);
        using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new AbsException($"Agent returned {(int)response.StatusCode}: {Preview(text)}");
        }

        using var document = JsonDocument.Parse(text);
        var content = document.RootElement.TryGetProperty("content", out var contentValue) &&
                      contentValue.ValueKind == JsonValueKind.Array &&
                      contentValue.GetArrayLength() > 0
            ? contentValue[0].TryGetProperty("text", out var textValue) ? textValue.GetString() ?? "" : text
            : text;

        return new AgentResponse
        {
            Messages = new List<AgentMessage> { new() { Role = "assistant", Content = content } },
            Raw = JsonValues.ToObject(document.RootElement),
        };
    }

    // ── Gemini ──────────────────────────────────────────────────────────────

    private async Task<AgentResponse> SendGeminiAsync(
        IReadOnlyList<AgentMessage> messages,
        AgentConfig config,
        CancellationToken cancellationToken)
    {
        var contents = messages
            .Where(message => message.Role != "system")
            .Select(message => new Dictionary<string, object?>
            {
                ["role"] = message.Role == "assistant" ? "model" : "user",
                ["parts"] = new List<object?>
                {
                    new Dictionary<string, object?> { ["text"] = message.Content ?? "" },
                },
            })
            .ToList();

        var url = config.Url;
        if (!string.IsNullOrEmpty(config.Token))
        {
            url += (url.Contains("?") ? "&" : "?") + "key=" + Uri.EscapeDataString(config.Token);
        }

        var body = new Dictionary<string, object?>
        {
            ["contents"] = contents,
            ["generationConfig"] = new Dictionary<string, object?> { ["maxOutputTokens"] = 1024 },
        };

        using var request = BuildRequest(url, body, config);
        using var timeout = CreateTimeout(config.TimeoutSeconds, cancellationToken);
        using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new AbsException($"Agent returned {(int)response.StatusCode}: {Preview(text)}");
        }

        using var document = JsonDocument.Parse(text);
        var content = "";
        if (document.RootElement.TryGetProperty("candidates", out var candidates) &&
            candidates.ValueKind == JsonValueKind.Array && candidates.GetArrayLength() > 0 &&
            candidates[0].TryGetProperty("content", out var candidateContent) &&
            candidateContent.TryGetProperty("parts", out var parts) &&
            parts.ValueKind == JsonValueKind.Array && parts.GetArrayLength() > 0 &&
            parts[0].TryGetProperty("text", out var partText))
        {
            content = partText.GetString() ?? "";
        }

        return new AgentResponse
        {
            Messages = new List<AgentMessage> { new() { Role = "assistant", Content = content } },
            Raw = JsonValues.ToObject(document.RootElement),
        };
    }

    // ── HTTP helpers ────────────────────────────────────────────────────────

    private static HttpRequestMessage BuildRequest(
        string url,
        Dictionary<string, object?> body,
        AgentConfig config)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        foreach (var header in BuildAuthHeaders(config))
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        return request;
    }

    private static CancellationTokenSource CreateTimeout(int seconds, CancellationToken cancellationToken)
    {
        var source = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        source.CancelAfter(TimeSpan.FromSeconds(seconds <= 0 ? 300 : seconds));
        return source;
    }

    private static Dictionary<string, string> BuildAuthHeaders(AgentConfig config)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (config.Auth == "api_key" && config.Token != null)
        {
            headers["X-API-Key"] = config.Token;
            return headers;
        }

        if ((config.Auth == "bearer" || config.Auth == "oauth2") && config.Token != null)
        {
            headers["Authorization"] = "Bearer " + config.Token;
            return headers;
        }

        var forwarded = ResolveForwardedAuthorization(config);
        if (forwarded != null) headers["Authorization"] = forwarded;
        return headers;
    }

    private static string? ResolveForwardedAuthorization(AgentConfig config)
    {
        if (!config.ForwardAuth && config.Authorization == null) return null;

        var raw = config.Authorization
                  ?? Environment.GetEnvironmentVariable("ABS_AGENT_AUTHORIZATION")
                  ?? Environment.GetEnvironmentVariable("HTTP_AUTHORIZATION")
                  ?? Environment.GetEnvironmentVariable("Authorization");

        if (!string.IsNullOrWhiteSpace(raw))
        {
            var trimmed = raw.Trim();
            return trimmed.IndexOf(' ') >= 0 ? trimmed : "Bearer " + trimmed;
        }

        var token = Environment.GetEnvironmentVariable("ABS_AGENT_TOKEN");
        if (!string.IsNullOrEmpty(token)) return "Bearer " + token;

        throw new AbsException(
            "Authorization forwarding is enabled but no value was found. " +
            "Pass Authorization or set ABS_AGENT_AUTHORIZATION / HTTP_AUTHORIZATION / ABS_AGENT_TOKEN.");
    }

    // ── Content helpers ─────────────────────────────────────────────────────

    private static long ElapsedMilliseconds(long started)
    {
        var elapsed = Stopwatch.GetTimestamp() - started;
        return (long)Math.Round(elapsed * 1000.0 / Stopwatch.Frequency);
    }

    private static string ToText(object? value) => value is string text ? text : AbsValues.Stringify(value);

    private static string ContentToString(object? value) =>
        value is string text ? text : JsonSerializer.Serialize(value);

    private static string Preview(string value) =>
        value.Length <= 200 ? value : value.Substring(0, 200);
}
