# iam-probe

Minimal AWS SAM app for probing which read-only IAM permissions actually
work in a sandbox account, before building anything real on top of them.

## Stack

- API Gateway (REST, `GET /test`) → Lambda (Python 3.12)
- Region: `us-west-2`
- The Lambda's IAM policy grants exactly:
  - `lambda:ListFunctions`
  - `cloudwatch:GetMetricData`
  - `dynamodb:ListTables`
  - `dynamodb:DescribeTable`

On invoke, the handler attempts all four calls and returns a JSON report of
which succeeded and which were denied (or, for `DescribeTable`, which
succeeded permission-wise but hit a different error, e.g. the table doesn't
exist).

## ⚠️ No auth on the endpoint

`GET /test` has no authorizer — anyone with the URL can call it and see
which AWS API calls succeed in this account, including raw results (e.g.
your Lambda function names, DynamoDB table names). Fine for a short-lived
sandbox test; tear down the stack (`sam delete`) when you're done, or add
an API key / IAM auth before leaving it up.

## Build and deploy

```bash
sam build
sam deploy --guided
```

Set the region to `us-west-2` when prompted. Answers are saved to
`samconfig.toml` for future `sam deploy` runs.

## Test the deployed endpoint

Use the `ApiEndpoint` value from the stack outputs:

```bash
curl "<ApiEndpoint>"
```

Or open it directly in a browser. To probe a specific DynamoDB table for
`DescribeTable` instead of the default placeholder name:

```bash
curl "<ApiEndpoint>?table=your-table-name"
```

Example response:

```json
{
  "lambda:ListFunctions": {"allowed": true, "result": {"Functions": [...]}},
  "cloudwatch:GetMetricData": {"allowed": false, "error": "User: ... is not authorized to perform: cloudwatch:GetMetricData ..."},
  "dynamodb:ListTables": {"allowed": true, "result": {"TableNames": [...]}},
  "dynamodb:DescribeTable": {"allowed": true, "note": "call succeeded permission-wise but returned ResourceNotFoundException", "error": "Requested resource not found"}
}
```

## Chrome extension (extension/)

A minimal popup UI in `extension/` calls the deployed endpoint and renders
allowed/denied per call, instead of using curl or a browser tab.

1. Deploy the stack first and copy the `ApiEndpoint` output.
2. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and select the `extension/` folder.
3. Click the extension icon, paste the endpoint URL, click **Run probe**.
   You'll be prompted once to grant it permission to call that host; the
   URL is remembered for next time via `chrome.storage.local`.

## Tear down

```bash
sam delete
```
