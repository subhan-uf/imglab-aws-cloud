import os, json, boto3
s3 = boto3.client("s3")

def _cors():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS"
    }

def _resp(status, body): 
    return {"statusCode": status, "headers": _cors(), "body": json.dumps(body)}

def lambda_handler(event, context):
    # Preflight
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 204, "headers": _cors(), "body": ""}

    bucket = os.environ["BUCKET"]
    prefix = os.environ.get("APPROVED_PREFIX", "approved/")
    ttl = int(os.environ.get("SIGNED_GET_TTL", "600"))

    items = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "ContinuationToken": token} if token else {"Bucket": bucket, "Prefix": prefix}
        out = s3.list_objects_v2(**kwargs)
        for o in out.get("Contents") or []:
            key = o["Key"]
            if key.endswith("/"): 
                continue
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=ttl
            )
            items.append({
                "key": key,
                "size": o["Size"],
                "lastModified": o["LastModified"].isoformat(),
                "url": url
            })
        if out.get("IsTruncated"):
            token = out.get("NextContinuationToken")
        else:
            break

    return _resp(200, {"ok": True, "items": items})
