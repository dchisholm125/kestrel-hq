OpenAPI Specification
=====================

This folder contains the OpenAPI specification for the Kestrel Protocol API.

## openapi.yaml

The `openapi.yaml` file defines the structure of the Kestrel Protocol API, including endpoints, request/response formats, and authentication methods.

## ErrorEnvelope

The OpenAPI now includes a canonical `ErrorEnvelope` schema used for all failed responses. SDKs expect failures to be shaped as:

 - `corr_id`: correlation id
 - `request_hash`: optional canonical request hash
 - `state`: current or terminal `IntentState`
 - `reason`: detailed `ReasonDetail` with `code`, `category`, `http_status`, `message`, and optional `context`
 - `ts`: RFC3339 UTC timestamp

Clients should prefer the canonical envelope over ad-hoc error formats.