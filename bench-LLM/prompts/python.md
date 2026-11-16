Generate Python 3 code that defines:

def transform(data):
    ...

Task:
{task}

Input tables (all columns may be nullable):
{schema}

The evaluator calls transform(data) where data is a dictionary mapping each table
name to a list of row dictionaries. Return the final table as a list of dictionaries.
You do not need to read the Parquet paths listed above: the same input values are
provided directly in data. Use only the Python standard library.

Preserve row order unless the task requests sorting. Match requested column names
and do not include additional columns. Handle nulls as Python None. Do not hardcode
input rows. Do not read files or make network calls.

Return ONLY the code. Do not include explanations or a call to transform.
