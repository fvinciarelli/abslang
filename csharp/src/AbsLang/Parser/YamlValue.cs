using System.Globalization;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace AbsLang;

/// <summary>
/// YAML → plain CLR values using an ABS-specific profile (close to YAML 1.2 core):
/// no date parsing, no yes/no/on/off booleans, quoted scalars stay strings.
/// </summary>
internal static class YamlValue
{
    public static List<object?> ParseStream(string raw)
    {
        var stream = new YamlStream();
        using var reader = new StringReader(raw);
        stream.Load(reader);
        return stream.Documents.Select(document => Convert(document.RootNode)).ToList();
    }

    private static object? Convert(YamlNode node)
    {
        switch (node)
        {
            case YamlScalarNode scalar:
                return ConvertScalar(scalar);
            case YamlSequenceNode sequence:
                return sequence.Children.Select(Convert).ToList();
            case YamlMappingNode mapping:
                var result = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var entry in mapping.Children)
                {
                    if (entry.Key is not YamlScalarNode key)
                    {
                        throw new AbsParseException("Non-scalar mapping keys are not supported in ABS documents.");
                    }
                    result[key.Value ?? ""] = Convert(entry.Value);
                }
                return result;
            default:
                return node.ToString();
        }
    }

    private static object? ConvertScalar(YamlScalarNode scalar)
    {
        var value = scalar.Value;

        // Quoted / literal / folded scalars are always strings.
        if (scalar.Style != ScalarStyle.Plain)
        {
            return value ?? "";
        }

        if (value is null || value.Length == 0 || value == "~" ||
            value.Equals("null", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (value.Equals("true", StringComparison.OrdinalIgnoreCase)) return true;
        if (value.Equals("false", StringComparison.OrdinalIgnoreCase)) return false;

        if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var integer))
        {
            return integer;
        }

        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var real))
        {
            return real;
        }

        // Everything else — including yes/no/on/off and ISO dates — stays a string.
        return value;
    }
}
