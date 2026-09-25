import json
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

lambda_client = boto3.client("lambda")
cloudwatch = boto3.client("cloudwatch")
dynamodb = boto3.client("dynamodb")


def lambda_handler(event, context):
    params = (event or {}).get("queryStringParameters") or {}
    probe_table_name = params.get("table", "iam-probe-nonexistent-table")

    results = {
        "lambda:ListFunctions": _probe(lambda_client.list_functions),
        "cloudwatch:GetMetricData": _probe(
            cloudwatch.get_metric_data,
            MetricDataQueries=[
                {
                    "Id": "m1",
                    "MetricStat": {
                        "Metric": {
                            "Namespace": "AWS/Lambda",
                            "MetricName": "Invocations",
                            "Dimensions": [
                                {
                                    "Name": "FunctionName",
                                    "Value": context.function_name,
                                }
                            ],
                        },
                        "Period": 300,
                        "Stat": "Sum",
                    },
                }
            ],
            StartTime=datetime.now(timezone.utc) - timedelta(hours=1),
            EndTime=datetime.now(timezone.utc),
        ),
        "dynamodb:ListTables": _probe(dynamodb.list_tables),
        "dynamodb:DescribeTable": _probe(
            dynamodb.describe_table, TableName=probe_table_name
        ),
    }

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(results, default=str),
    }


def _probe(fn, **kwargs):
    try:
        return {"allowed": True, "result": fn(**kwargs)}
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("AccessDenied", "AccessDeniedException"):
            return {"allowed": False, "error": exc.response["Error"]["Message"]}
        # Permission was granted; the call still failed for another reason
        # (e.g. the probed resource doesn't exist).
        return {
            "allowed": True,
            "note": f"call succeeded permission-wise but returned {code}",
            "error": exc.response["Error"]["Message"],
        }
