You generate programs in Capybara, an ETL DSL compiled to Python/Polars.
Return ONLY the program, without explanations. Do not use Anka syntax or Python.

Task:
{task}

Input tables (all columns may be nullable):
{schema}

I/O contract:
- The evaluator supplies the declared tables as Parquet files at the paths above.
- Write exactly one final table to PARQUET(file: "output.parquet").
- Use only declared input columns and requested output columns. Preserve row order
  unless the task requests sorting. Match the requested column names.
- Do not hardcode input rows or read any other file.

Language reference:
- Keywords are uppercase, identifiers are case sensitive, strings use double quotes.
- Blocks use braces. FROM, TO, SOURCE, SINK and schema declarations end in semicolons.
- An operation block has no semicolon after its closing brace.
- Types: INT, DECIMAL, STRING, BOOL, DATE, DATETIME; '?' permits nulls.
- Linear pipelines begin with FROM and end with TO. Each operation consumes the
  previous table. Example on an unrelated schema:

PIPELINE task {
    FROM PARQUET(file: "input/readings.parquet")
        AS TABLE[sensor: STRING?, value: DECIMAL?];
    FILTER { WHERE value IS NOT NULL AND value > 0; }
    DERIVE { adjusted = value * 1.1; }
    AGGREGATE { GROUP_BY sensor; SUM(adjusted) AS total; COUNT() AS count; }
    SORT { BY total DESC; }
    TO PARQUET(file: "output.parquet");
}

Operations:
FILTER { WHERE expression; }
SELECT { COLUMNS col1, col2; }
DERIVE { new_column = expression; }
AGGREGATE { GROUP_BY col1, col2; SUM(value) AS total; COUNT() AS count; }
SORT { BY col1 ASC, col2 DESC; }
RENAME { old_name AS new_name; }
FILL_NULL { col = expression; }
DROP_NULLS { COLUMNS col1, col2; }
DISTINCT { COLUMNS col1, col2; }

GROUP_BY is optional. Aggregates: SUM, AVG, MIN, MAX and COUNT. Only COUNT()
accepts zero arguments. DISTINCT projects the listed columns and removes duplicates.
DERIVE only adds new columns. Assignments in a single DERIVE see its input schema;
use consecutive DERIVE blocks when the second computation uses a new column.

Expressions support + - * /, == != < <= > >=, AND OR NOT, parentheses,
TRUE FALSE NULL, IS NULL, IS NOT NULL. Never compare directly with NULL.
Scalar functions: COALESCE(a,b,...), NULLIF(a,b), SAFE_DIVIDE(a,b),
LOWER(s), UPPER(s), TRIM(s). Do not invent IF, ROUND, LIMIT, UNION,
CONTAINS, IN, string concatenation, string casts or date functions.
Replace finite membership tests with equality comparisons joined by OR.

JOIN requires the graph form. Sources and sinks are declared once; only FLOW
defines connections. Example on an unrelated schema:

PIPELINE task {
    SOURCE readings: TABLE[sensor_id: INT?, value: DECIMAL?]
        = PARQUET(file: "input/readings.parquet");
    SOURCE sensors: TABLE[key: INT?, label: STRING?]
        = PARQUET(file: "input/sensors.parquet");
    STEP combined = JOIN { TYPE INNER; ON left.sensor_id == right.key; }
    STEP chosen = SELECT { COLUMNS sensor_id, value, label; }
    SINK result = PARQUET(file: "output.parquet");
    FLOW { readings -> combined.left; sensors -> combined.right; combined -> chosen -> result; }
}

JOIN supports INNER, LEFT, RIGHT, FULL. Qualifiers left/right are only used inside
JOIN conditions; other operations use unqualified column names. Rename conflicting
columns before joining when needed, then select exactly the requested output.
Every source must be connected and every result must reach the output sink.
