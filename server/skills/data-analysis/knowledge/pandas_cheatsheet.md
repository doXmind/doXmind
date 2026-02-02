# Pandas Cheatsheet

## Reading Data

```python
# CSV
df = pd.read_csv('file.csv')
df = pd.read_csv('file.csv', encoding='utf-8', sep=',')

# Excel
df = pd.read_excel('file.xlsx', sheet_name='Sheet1')

# JSON
df = pd.read_json('file.json')

# From dict
df = pd.DataFrame({'col1': [1,2], 'col2': [3,4]})
```

## Quick Inspection

```python
df.head(10)          # First 10 rows
df.tail(5)           # Last 5 rows
df.shape             # (rows, columns)
df.columns           # Column names
df.dtypes            # Data types
df.info()            # Summary info
df.describe()        # Statistics
df.nunique()         # Unique values per column
df.value_counts()    # Value counts
```

## Selection & Filtering

```python
# Select columns
df['col']            # Single column
df[['col1', 'col2']] # Multiple columns

# Filter rows
df[df['col'] > 5]
df[(df['a'] > 1) & (df['b'] < 10)]
df[df['col'].isin(['A', 'B'])]
df.query('col > 5')

# Select by position
df.iloc[0]           # First row
df.iloc[:5, :3]      # First 5 rows, first 3 cols

# Select by label
df.loc[df['id'] == 1, 'name']
```

## Data Cleaning

```python
# Missing values
df.isna().sum()              # Count NaN per column
df.dropna()                  # Drop rows with NaN
df.fillna(0)                 # Fill NaN with value
df.fillna(df.mean())         # Fill with mean

# Duplicates
df.drop_duplicates()
df.duplicated().sum()

# Rename
df.rename(columns={'old': 'new'})

# Change type
df['col'] = df['col'].astype(int)
df['date'] = pd.to_datetime(df['date'])
```

## Transformations

```python
# Apply function
df['col'].apply(lambda x: x * 2)
df.apply(lambda row: row['a'] + row['b'], axis=1)

# String operations
df['col'].str.lower()
df['col'].str.contains('pattern')
df['col'].str.split('-').str[0]

# Binning
pd.cut(df['col'], bins=3)
pd.qcut(df['col'], q=4)  # Quantile-based
```

## Aggregation

```python
# Basic stats
df['col'].sum()
df['col'].mean()
df['col'].median()
df['col'].std()
df['col'].min(), df['col'].max()

# Group by
df.groupby('category').sum()
df.groupby('category').agg({
    'sales': 'sum',
    'qty': 'mean'
})
df.groupby(['a', 'b']).size()  # Counts
```

## Reshaping

```python
# Pivot table
pd.pivot_table(df, values='sales', index='date', columns='product')

# Melt (wide to long)
pd.melt(df, id_vars=['id'], value_vars=['col1', 'col2'])

# Merge/Join
pd.merge(df1, df2, on='key')
pd.merge(df1, df2, left_on='a', right_on='b', how='left')

# Concat
pd.concat([df1, df2])           # Stack vertically
pd.concat([df1, df2], axis=1)   # Stack horizontally
```

## Time Series

```python
# Convert to datetime
df['date'] = pd.to_datetime(df['date'])

# Set index
df.set_index('date', inplace=True)

# Resample
df.resample('D').sum()   # Daily
df.resample('W').mean()  # Weekly
df.resample('M').sum()   # Monthly

# Rolling window
df['rolling_avg'] = df['col'].rolling(7).mean()

# Shift
df['prev'] = df['col'].shift(1)   # Previous value
df['next'] = df['col'].shift(-1)  # Next value
```

## Sorting

```python
df.sort_values('col')
df.sort_values('col', ascending=False)
df.sort_values(['col1', 'col2'], ascending=[True, False])
df.nlargest(10, 'col')   # Top 10
df.nsmallest(5, 'col')   # Bottom 5
```

## Output

```python
# To CSV
df.to_csv('output.csv', index=False)

# To Excel
df.to_excel('output.xlsx', index=False)

# To JSON
df.to_json('output.json', orient='records')

# To dict
df.to_dict('records')
```
