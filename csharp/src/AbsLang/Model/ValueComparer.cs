using System.Globalization;
using System.Text.Json;

namespace AbsLang;

/// <summary>Canonical value comparison shared by matching, tool_call and chain evaluators.</summary>
public static class AbsValues
{
    public static bool DeepEquals(object? left, object? right)
    {
        if (ReferenceEquals(left, right)) return true;
        if (left is null || right is null) return false;

        if (IsNumber(left) && IsNumber(right))
        {
            if (IsIntegral(left) && IsIntegral(right))
            {
                return Convert.ToInt64(left, CultureInfo.InvariantCulture) ==
                       Convert.ToInt64(right, CultureInfo.InvariantCulture);
            }
            return Math.Abs(ToDouble(left) - ToDouble(right)) < 1e-12;
        }

        if (left is string ls && right is string rs) return string.Equals(ls, rs, StringComparison.Ordinal);
        if (left is bool lb && right is bool rb) return lb == rb;

        if (left is Dictionary<string, object?> lm &&
            right is IReadOnlyDictionary<string, object?> rm)
        {
            if (lm.Count != rm.Count) return false;
            foreach (var pair in lm)
            {
                if (!rm.TryGetValue(pair.Key, out var value)) return false;
                if (!DeepEquals(pair.Value, value)) return false;
            }
            return true;
        }

        if (left is IReadOnlyList<object?> ll && right is IReadOnlyList<object?> rl)
        {
            if (ll.Count != rl.Count) return false;
            for (var i = 0; i < ll.Count; i++)
            {
                if (!DeepEquals(ll[i], rl[i])) return false;
            }
            return true;
        }

        return left.Equals(right);
    }

    public static bool IsNumber(object? value) =>
        value is byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal;

    public static bool IsIntegral(object? value) =>
        value is byte or sbyte or short or ushort or int or uint or long or ulong;

    public static double ToDouble(object? value) =>
        Convert.ToDouble(value, CultureInfo.InvariantCulture);

    public static string Stringify(object? value)
    {
        switch (value)
        {
            case null:
                return "null";
            case string s:
                return s;
            case bool b:
                return b ? "true" : "false";
            case double d:
                return d.ToString("R", CultureInfo.InvariantCulture);
            case float f:
                return f.ToString("R", CultureInfo.InvariantCulture);
            default:
                if (IsNumber(value)) return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
                try
                {
                    return JsonSerializer.Serialize(value);
                }
                catch
                {
                    return value.ToString() ?? "";
                }
        }
    }
}
