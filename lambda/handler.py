import base64
import json
from importlib import metadata

# The 3 packages come from the Lambda Layer (mounted at /opt/python)
import emoji
import requests
from slugify import slugify

LAYER_DIR = "/opt/python"


def get_installed_packages():
    """Split every installed package into: ones from our layer vs ones AWS provides."""
    from_layer, runtime = {}, {}

    for dist in metadata.distributions():
        name = dist.metadata["Name"]
        location = str(dist.locate_file(""))
        target = from_layer if location.startswith(LAYER_DIR) else runtime
        target[name] = dist.version

    return sort_by_name(from_layer), sort_by_name(runtime)


def sort_by_name(packages):
    return {name: packages[name] for name in sorted(packages, key=str.lower)}


def read_text(event):
    """Get 'text' from a POST JSON body, or from ?text= on a GET."""
    body = event.get("body")
    if body:
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        try:
            return json.loads(body).get("text")
        except (json.JSONDecodeError, AttributeError):
            return None
    params = event.get("queryStringParameters") or {}
    return params.get("text")


def respond(status, payload):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload, indent=2, ensure_ascii=False),
    }


def lambda_handler(event, context):
    text = read_text(event)
    if not text:
        return respond(400, {"error": 'Send JSON like {"text": "hello"} in the request body'})

    from_layer, runtime = get_installed_packages()

    return respond(200, {
        "you_sent": text,
        "processed_with_our_packages": {
            "emoji": emoji.emojize(text, language="alias"),
            "python-slugify": slugify(text),
            "requests": requests.utils.quote(text),
        },
        "packages_from_our_layer": from_layer,
        "packages_from_lambda_runtime": runtime,
    })