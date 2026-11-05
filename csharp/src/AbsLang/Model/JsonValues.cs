using System.Text.Json;

namespace AbsLang;

/// <summary>JSON helpers shared by the parser and the agent adapters.</summary>
internal static class JsonValues
{
    public static object? Parse(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try
        {
            using var document = JsonDocument.Parse(text);
            return ToObject(document.RootElement);
        }
        catch (JsonException)
        {
            return text;
        }
    }

    public static object? ToObject(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return null;
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Number:
                return element.TryGetInt64(out var integer) ? integer : element.GetDouble();
            case JsonValueKind.Array:
                var list = new List<object?>();
                foreach (var item in element.EnumerateArray()) list.Add(ToObject(item));
                return list;
            case JsonValueKind.Object:
                var map = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var property in element.EnumerateObject()) map[property.Name] = ToObject(property.Value);
                return map;
            default:
                return null;
        }
    }
}
