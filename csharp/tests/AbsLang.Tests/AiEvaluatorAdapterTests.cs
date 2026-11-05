using System.Net;
using System.Net.Http;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class AiEvaluatorAdapterTests
{
    [Fact]
    public async Task CallsDirectEndpoint()
    {
        var stub = new StubHandler().Json("""
{"results":[{"scores":{"g_eval":0.9},"details":{"g_eval":{"reason":"clear"}}}]}
""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            AiEvaluatorAdapter.Configure("key", "http://eval");
            var result = await AiEvaluatorAdapter.EvaluateAsync(
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("llm_judge", ("criteria", "helpful")));

            Assert.True(result.Passed);
            Assert.Equal(0.9, result.Score, 1e-9);
            Assert.Equal("http://eval/api/v1/evaluations/direct", stub.Requests[0].RequestUri!.ToString());
            Assert.Equal("key", stub.Requests[0].Headers.GetValues("X-API-Key").Single());
            Assert.Contains("\"metrics\":[\"g_eval\"]", stub.Bodies[0]);
            Assert.Contains("helpful", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
        }
    }

    [Fact]
    public async Task MapsGroundednessMetric()
    {
        var stub = new StubHandler().Json("""
{"results":[{"scores":{"hallucination":0.75},"details":{"hallucination":{"reason":"grounded"}}}]}
""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            AiEvaluatorAdapter.Configure("key", "http://eval");
            var result = await AiEvaluatorAdapter.EvaluateAsync(
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("Groundedness",
                    ("query", "q"),
                    ("context", "c"),
                    ("response", "hello")));

            Assert.True(result.Passed);
            Assert.Contains("\"metrics\":[\"hallucination\"]", stub.Bodies[0]);
            Assert.Contains("\"context\":\"c\"", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
        }
    }

    [Fact]
    public async Task HttpErrorBecomesAdapterError()
    {
        var stub = new StubHandler().Json("oops", HttpStatusCode.InternalServerError);
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            AiEvaluatorAdapter.Configure("key", "http://eval");
            var result = await AiEvaluatorAdapter.EvaluateAsync(
                Array.Empty<ObservedStep>(),
                TestData.Rule("llm_judge"));

            Assert.False(result.Passed);
            Assert.Equal("adapter.error", result.Code);
            Assert.Contains("500", result.Reason);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
        }
    }
}
