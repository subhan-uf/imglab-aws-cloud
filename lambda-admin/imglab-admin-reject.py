import os, json, boto3
s3 = boto3.client("s3")

def _cors():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS"
    }

def _resp(status, body):
    return {"statusCode": status, "headers": _cors(), "body": json.dumps(body)}

def lambda_handler(event, context):
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 204, "headers": _cors(), "body": ""}

    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    groups = claims.get("cognito:groups")
    is_admin = False
    if isinstance(groups, list):
        is_admin = any(g.lower() == "admins" or g.lower() == "admin" for g in groups)
    elif isinstance(groups, str):
        is_admin = any(g.strip().lower() in ["admins", "admin"] for g in groups.split(","))


    bucket = os.environ["BUCKET"]
    pending = os.environ.get("PENDING_PREFIX", "pending/")
    rejected = os.environ.get("REJECTED_PREFIX", "rejected/")

    try:
        body = json.loads(event.get("body") or "{}")
        key = body.get("key") or ""
    except Exception:
        return _resp(400, {"ok": False, "error": "Invalid JSON body"})

    if not key.startswith(pending):
        return _resp(400, {"ok": False, "error": "key must be under pending/ prefix"})

    dest_key = key.replace(pending, rejected, 1)
    s3.copy_object(Bucket=bucket, Key=dest_key, CopySource={"Bucket": bucket, "Key": key})
    s3.delete_object(Bucket=bucket, Key=key)

    return _resp(200, {"ok": True, "rejectedKey": dest_key})
