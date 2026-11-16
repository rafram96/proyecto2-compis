Generate Python 3 code using the Polars library (import polars as pl).
Define a function:

def transform(data):
    ...

Task:
{task}

Input tables (all columns may be nullable):
{schema}

Execution contract:
- The evaluator supplies data as a dict mapping each table name to a typed
  polars.DataFrame. For example, data["readings"] is already a DataFrame.
- The Parquet paths above describe the equivalent Capybara inputs. Do not read
  those paths: use the DataFrames supplied in data.
- Return a polars.DataFrame or polars.LazyFrame containing the final table.
  The evaluator collects LazyFrames and converts the table to rows for comparison.
- Import Polars explicitly. Implement the transformations with Polars operations
  and expressions, not Python row loops or list comprehensions. Do not use Pandas.
- Preserve input row order unless the task requests sorting. Match the requested
  column names and retain original columns unless projection/aggregation is requested.
- Do not hardcode rows, read files, write files, or make network calls.

Polars reference:
- Filter: df.filter(pl.col("value") > 0).
- Projection: df.select("sensor", "value").
- Add a column: df.with_columns((pl.col("value") * 1.1).alias("adjusted")).
- Dependent computed columns require consecutive with_columns calls.
- Global aggregates: df.select(pl.col("value").sum().alias("total"), pl.len().alias("count")).
- Grouped aggregates: df.group_by("sensor", maintain_order=True).agg(
    pl.col("value").sum().alias("total"), pl.len().alias("count")).
- Other aggregates: mean(), min(), max(), count() on an expression.
- Sorting: df.sort("value", descending=True, maintain_order=True).
- Renaming: df.rename({"old_name": "new_name"}).
- String operations: pl.col("label").str.to_uppercase(), .str.to_lowercase(),
  .str.strip_chars(). Null handling: .is_null(), .is_not_null(), .fill_null(...).
- Logical expressions use &, | and ~ with each comparison parenthesized.
- Join: left.join(right, left_on="sensor_id", right_on="key", how="inner",
    maintain_order="left"). Rename colliding columns before joining if needed,
  then project exactly the requested output columns.
- Grouping may reorder rows without maintain_order=True. For multiple sort keys,
  pass a list of column names and matching descending flags.

Example on an unrelated schema:

import polars as pl

def transform(data):
    return (
        data["readings"]
        .filter(pl.col("value").is_not_null() & (pl.col("value") > 0))
        .with_columns((pl.col("value") * 1.1).alias("adjusted"))
        .group_by("sensor", maintain_order=True)
        .agg(pl.col("adjusted").sum().alias("total"), pl.len().alias("count"))
        .sort("total", descending=True, maintain_order=True)
    )

Return ONLY the complete code. Do not include explanations or call transform.
