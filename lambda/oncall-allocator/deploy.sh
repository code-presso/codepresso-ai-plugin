#!/bin/bash
# Deploy updated oncall-allocator Lambda with Google Calendar integration
#
# Prerequisites:
# 1. Create a Google Cloud service account with Calendar API access
# 2. Share the oncall Google Calendar with the service account email (Editor role)
# 3. Store the service account JSON key in AWS Secrets Manager:
#    aws secretsmanager create-secret --name oncall-google-service-account \
#      --secret-string file://service-account-key.json --region ap-northeast-2
# 4. Add IAM permission for Lambda to read the secret (secretsmanager:GetSecretValue)

set -euo pipefail

FUNCTION_NAME="oncall-allocator-stack-OnCallAllocatorFunction-pQRyUZlV0CCh"
REGION="ap-northeast-2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="/tmp/oncall-lambda-build"

echo "=== Building Lambda deployment package ==="

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Install dependencies
pip install --target "$BUILD_DIR" \
  google-api-python-client \
  google-auth \
  --quiet

# Copy Lambda code
cp "$SCRIPT_DIR/app.py" "$BUILD_DIR/"

# Create zip
cd "$BUILD_DIR"
zip -r /tmp/oncall-lambda-deploy.zip . -q

echo "=== Package size: $(du -h /tmp/oncall-lambda-deploy.zip | cut -f1) ==="

# Update Lambda code
echo "=== Deploying to Lambda ==="
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb:///tmp/oncall-lambda-deploy.zip \
  --region "$REGION"

# Wait for update to complete
echo "=== Waiting for Lambda update ==="
aws lambda wait function-updated \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION"

# Add new environment variables (preserving existing ones)
echo "=== Updating environment variables ==="
CURRENT_ENV=$(aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'Environment.Variables' --output json)

UPDATED_ENV=$(echo "$CURRENT_ENV" | python3 -c "
import sys, json
env = json.load(sys.stdin)
env['GOOGLE_CALENDAR_ID'] = 'c_b96d007ccd3a348ceab92e4d7cab4be4ae911977da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com'
env['GOOGLE_CREDENTIALS_SECRET'] = 'oncall-google-service-account'
# BACKEND_ENGINEER_LIST: 매주 반드시 포함되어야 하는 백엔드 엔지니어 목록 (쉼표 구분)
# 미설정 시 역할 구분 없이 누적 횟수 기반으로만 배정됩니다.
# 예: env['BACKEND_ENGINEER_LIST'] = '마경욱,이명석,이윤혁'
print(json.dumps({'Variables': env}))
")

aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --environment "$UPDATED_ENV" \
  --region "$REGION"

echo "=== Deploy complete ==="
echo ""
echo "New environment variables added:"
echo "  - GOOGLE_CALENDAR_ID"
echo "  - GOOGLE_CREDENTIALS_SECRET"
echo ""
echo "Don't forget to:"
echo "  1. Create the secret in Secrets Manager (oncall-google-service-account)"
echo "  2. Grant Lambda's IAM role access to secretsmanager:GetSecretValue"
echo "  3. Share the Google Calendar with the service account email"
