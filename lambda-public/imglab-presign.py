# lambda_function.py (Python 3.12)
import os, json, uuid
import boto3

s3 = boto3.client("s3")
sns = boto3.client("sns")

BUCKET = os.environ["BUCKET"]
MAX_BYTES = int(os.environ.get("MAX_BYTES", "2000000"))
ALLOWED = [
    t.strip().lower()
    for t in os.environ.get("ALLOWED_TYPES", "image/jpeg,image/png,image/webp").split(",")
    if t.strip()
]
SNS_TOPIC = os.environ.get("SNS_TOPIC_ARN")


def _cors():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _resp(status, body):
    return {"statusCode": status, "headers": _cors(), "body": json.dumps(body)}


def lambda_handler(event, context):
    # CORS preflight
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 204, "headers": _cors(), "body": ""}

    # Read user id from claims
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    user_id = claims.get("sub") or (event.get("headers") or {}).get("x-test-user")
    if not user_id:
        return _resp(401, {"ok": False, "error": "Unauthorized (no user id)"})

    # Parse body
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        body = {}

    content_type = (body.get("contentType") or "").lower()
    CT_TO_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
    ext = CT_TO_EXT.get(content_type)

    if content_type not in ALLOWED or not ext:
        return _resp(
            400,
            {"ok": False, "error": f"Invalid contentType. Allowed: {', '.join(ALLOWED)}"},
        )

    # Enforce ONE upload per user
    prefixes = [f"pending/{user_id}/", f"approved/{user_id}/", f"rejected/{user_id}/"]
    for prefix in prefixes:
        out = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix, MaxKeys=1)
        if out.get("KeyCount", 0) > 0:
            return _resp(
                403, {"ok": False, "error": "You have already uploaded an image."}
            )

    # SNS notification (safe)
    if SNS_TOPIC:
        try:
            sns.publish(
                TopicArn=SNS_TOPIC,
                Subject="Someone uploaded an image!",
                Message=f"User {user_id} requested to upload an image, accept or reject it in the admin portal.",
            )
        except Exception as e:
            print("SNS publish failed:", str(e))

    # Create a presigned POST
    key = f"pending/{user_id}/{uuid.uuid4()}.{ext}"
    presigned = s3.generate_presigned_post(
        Bucket=BUCKET,
        Key=key,
        ExpiresIn=120,
        Conditions=[
            ["content-length-range", 1, MAX_BYTES],
            ["starts-with", "$Content-Type", "image/"],
        ],
        Fields={"Content-Type": content_type},
    )

    return _resp(
        200,
        {
            "ok": True,
            "upload": {"url": presigned["url"], "fields": presigned["fields"]},
            "target": {
                "bucket": BUCKET,
                "key": key,
                "contentType": content_type,
                "maxBytes": MAX_BYTES,
            },
        },
    )
