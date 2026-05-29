import os
import json
import boto3
from datetime import datetime, timedelta
import urllib3
from calendar import monthcalendar

from google.oauth2 import service_account
from googleapiclient.discovery import build

# DynamoDB 클라이언트 초기화
dynamodb = boto3.resource("dynamodb")
table_name = os.environ.get("DYNAMODB_TABLE")
oncall_table = dynamodb.Table(table_name)

# 환경 변수에서 엔지니어 목록 가져오기
ENGINEERS = [e.strip() for e in os.environ.get("ENGINEER_LIST", "").split(",") if e.strip()]

# 백엔드 엔지니어 목록 (매주 반드시 1명 포함해야 하는 그룹)
BACKEND_ENGINEERS = set(
    e.strip() for e in os.environ.get("BACKEND_ENGINEERS", "").split(",") if e.strip()
)

# Google Calendar 설정
GOOGLE_CALENDAR_ID = os.environ.get(
    "GOOGLE_CALENDAR_ID",
    "c_b96d007ccd3a348ceab92e4d7cab4be4ae911977da9f383a7a7bb0e4bd74f12f1@group.calendar.google.com"
)
GOOGLE_CREDENTIALS_SECRET = os.environ.get("GOOGLE_CREDENTIALS_SECRET", "oncall-google-service-account")


def get_google_calendar_service():
    """Google Calendar API 서비스를 초기화합니다."""
    secret_name = GOOGLE_CREDENTIALS_SECRET
    region = os.environ.get("AWS_REGION", "ap-northeast-2")

    sm_client = boto3.client("secretsmanager", region_name=region)
    secret_value = sm_client.get_secret_value(SecretId=secret_name)
    creds_json = json.loads(secret_value["SecretString"])

    credentials = service_account.Credentials.from_service_account_info(
        creds_json,
        scopes=["https://www.googleapis.com/auth/calendar"]
    )
    return build("calendar", "v3", credentials=credentials)


def get_weeks_in_month(year, month):
    """특정 월의 주 시작일(월요일)과 종료일(일요일)을 계산합니다."""
    weeks = []
    for week in monthcalendar(year, month):
        if week[0] != 0:
            start_of_week = datetime(year, month, week[0])
            end_of_week = start_of_week + timedelta(days=6)
            weeks.append((start_of_week, end_of_week))
    return weeks


def get_historical_counts(engineers):
    """DynamoDB에서 엔지니어별 누적 주/부 담당 횟수를 조회합니다."""
    primary_counts = {e: 0 for e in engineers}
    secondary_counts = {e: 0 for e in engineers}

    try:
        response = oncall_table.scan()
        while True:
            for item in response.get("Items", []):
                engineer = item.get("Engineer")
                role = item.get("Role")
                if engineer in primary_counts:
                    if role == "Primary":
                        primary_counts[engineer] += 1
                    elif role == "Secondary":
                        secondary_counts[engineer] += 1
            if "LastEvaluatedKey" not in response:
                break
            response = oncall_table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
    except Exception as e:
        print(f"Warning: Could not fetch historical counts from DynamoDB: {e}")

    return primary_counts, secondary_counts


def generate_monthly_plan(engineers, backend_engineers, year, month):
    """월간 온콜 계획을 생성합니다.

    배정 규칙 (역할 구분이 설정된 경우):
    - 주 담당자: 백엔드/프론트 그룹별 누적 주 담당 비율(횟수÷인원수)을 비교해
                비율이 낮은 그룹에서 선정 → 두 그룹이 비슷한 비율로 주 담당을 맡음.
                동률이면 백엔드 우선 (매주 백엔드 포함 강화).
                같은 그룹 내에서는 누적 주 담당 횟수가 가장 적은 엔지니어 선정
                (동점이면 누적 부 담당 횟수로 비교).
    - 부 담당자: 주 담당이 프론트엔드이면 반드시 백엔드에서 선정 (필수 포함 조건).
                주 담당이 백엔드이면 전체에서 누적 부 담당 횟수가 가장 적은 엔지니어 선정
                (동점이면 누적 주 담당 횟수로 비교).

    역할 구분이 없는 경우: 전체 누적 주 담당 횟수가 가장 적은 엔지니어 선정 (기존 방식).
    """
    weeks = get_weeks_in_month(year, month)
    plan = []

    # 누적 횟수 조회 — 주/부 역할을 분리해서 비교하는 것이 공정 배분의 핵심
    primary_counts, secondary_counts = get_historical_counts(engineers)
    print(f"Historical primary counts: {primary_counts}")
    print(f"Historical secondary counts: {secondary_counts}")

    use_role_constraint = bool(backend_engineers)
    backend_list = [e for e in engineers if e in backend_engineers] if use_role_constraint else []
    frontend_list = [e for e in engineers if e not in backend_engineers] if use_role_constraint else []

    for start_date, end_date in weeks:
        if use_role_constraint and backend_list and frontend_list:
            # 그룹별 누적 주 담당 비율(횟수÷인원수) 계산
            # 비율이 낮은 그룹 = 상대적으로 주 담당을 덜 맡아온 그룹 → 이번 주 주 담당 그룹으로 선정
            backend_primary_rate = sum(primary_counts[e] for e in backend_list) / len(backend_list)
            frontend_primary_rate = sum(primary_counts[e] for e in frontend_list) / len(frontend_list)

            # 동률이면 백엔드 우선 (매주 백엔드 포함 원칙 강화)
            if backend_primary_rate <= frontend_primary_rate:
                primary_group = backend_list
            else:
                primary_group = frontend_list

            primary = min(primary_group, key=lambda e: (primary_counts[e], secondary_counts[e]))
        else:
            # 역할 구분 없음 또는 한 그룹만 존재 → 전체 비교
            primary = min(engineers, key=lambda e: (primary_counts[e], secondary_counts[e]))

        # 부 담당자 후보 결정
        if use_role_constraint and primary not in backend_engineers:
            # 주 담당이 프론트엔드 → 부 담당은 반드시 백엔드에서 선정 (필수 포함 조건)
            candidates = [e for e in engineers if e != primary and e in backend_engineers]
            if not candidates:
                # 예외: 백엔드 엔지니어가 없거나 전원 주 담당인 경우
                candidates = [e for e in engineers if e != primary]
        else:
            # 주 담당이 백엔드이거나 역할 구분 미설정 → 전체에서 부 담당 선정
            candidates = [e for e in engineers if e != primary]

        # 부 담당자: 누적 '부 담당' 횟수 기준 오름차순, 동점이면 '주 담당' 횟수로 비교
        secondary = min(candidates, key=lambda e: (secondary_counts[e], primary_counts[e]))

        plan.append({
            "week": f"{start_date.strftime('%Y.%m.%d')} ~ {end_date.strftime('%Y.%m.%d')}",
            "start_date": start_date.strftime('%Y-%m-%d'),
            "end_date": (end_date + timedelta(days=1)).strftime('%Y-%m-%d'),
            "primary": primary,
            "secondary": secondary
        })

        # 이번 달 내 다음 주 배정을 위해 누적 횟수 반영
        primary_counts[primary] += 1
        secondary_counts[secondary] += 1

    return plan


def sync_to_google_calendar(monthly_plan, year, month):
    """월간 온콜 계획을 Google Calendar에 동기화합니다."""
    try:
        service = get_google_calendar_service()
    except Exception as e:
        print(f"Failed to initialize Google Calendar service: {e}")
        return

    # 해당 월의 기존 온콜 이벤트 삭제
    time_min = f"{year}-{month:02d}-01T00:00:00+09:00"
    if month == 12:
        time_max = f"{year + 1}-01-01T00:00:00+09:00"
    else:
        time_max = f"{year}-{month + 1:02d}-01T00:00:00+09:00"

    try:
        existing_events = service.events().list(
            calendarId=GOOGLE_CALENDAR_ID,
            timeMin=time_min,
            timeMax=time_max,
            q="온콜",
            singleEvents=True
        ).execute()

        for event in existing_events.get("items", []):
            service.events().delete(
                calendarId=GOOGLE_CALENDAR_ID,
                eventId=event["id"]
            ).execute()
            print(f"Deleted existing event: {event.get('summary', 'N/A')}")
    except Exception as e:
        print(f"Error cleaning up existing events: {e}")

    # 새 이벤트 생성
    for week_plan in monthly_plan:
        event_body = {
            "summary": f"온콜: {week_plan['primary']} (주) / {week_plan['secondary']} (부)",
            "description": (
                f"주 담당자: {week_plan['primary']}\n"
                f"부 담당자: {week_plan['secondary']}\n\n"
                f"기간: {week_plan['week']}"
            ),
            "start": {
                "date": week_plan["start_date"],
                "timeZone": "Asia/Seoul"
            },
            "end": {
                "date": week_plan["end_date"],
                "timeZone": "Asia/Seoul"
            },
            "colorId": "11",  # Tomato
            "transparency": "transparent",  # 다른 일정에 영향 없음
        }

        try:
            created = service.events().insert(
                calendarId=GOOGLE_CALENDAR_ID,
                body=event_body
            ).execute()
            print(f"Created calendar event: {created.get('summary')} ({created.get('id')})")
        except Exception as e:
            print(f"Error creating calendar event for {week_plan['week']}: {e}")


def send_google_chat_notification(monthly_plan, year, month):
    """월간 온콜 계획을 Google Chat으로 전송합니다."""
    webhook_urls_str = os.environ.get("GOOGLE_CHAT_WEBHOOK_URLS")
    if not webhook_urls_str:
        print("Google Chat webhook URLs not configured. Skipping notification.")
        return

    webhook_urls = [url.strip() for url in webhook_urls_str.split(',')]
    http = urllib3.PoolManager()

    month_str = f"{year}년 {month}월"

    plan_details = []
    for week_plan in monthly_plan:
        plan_details.append(
            f"*{week_plan['week']}*\n- 주 담당자: {week_plan['primary']}\n- 부 담당자: {week_plan['secondary']}"
        )

    plan_details_str = "\n\n".join(plan_details)

    message_text = (
        f"<users/all> *{month_str} 온콜 엔지니어 할당 안내*\n\n"
        "안녕하세요! 이번 달 시스템 안정성 및 긴급 상황 대응을 위한 온콜(On-Call) 엔지니어 월간 계획입니다.\n\n"
        f"{plan_details_str}\n\n"
        "*온콜 엔지니어란?*\n"
        "서비스 운영 중 발생하는 기술적인 문제나 긴급 상황 발생 시, 즉시 대응하여 문제를 해결하는 역할을 담당하는 엔지니어입니다.\n\n"
        "해당 온콜 계획은 아래 구글 캘린더에 등록되어 있습니다.\n"
        f"https://calendar.google.com/calendar/embed?src={GOOGLE_CALENDAR_ID}&ctz=Asia%2FSeoul\n\n"
        "궁금한 점이나 기술적인 지원이 필요하시면 언제든지 온콜 담당자에게 문의해 주세요.\n"
        "감사합니다!"
    )

    message = {"text": message_text}
    encoded_message = json.dumps(message).encode("utf-8")

    headers = {"Content-Type": "application/json; charset=UTF-8"}

    for webhook_url in webhook_urls:
        try:
            response = http.request("POST", webhook_url, body=encoded_message, headers=headers)
            if response.status == 200:
                print(f"Successfully sent notification to Google Chat webhook: {webhook_url}")
            else:
                print(f"Failed to send notification to {webhook_url}. Status: {response.status}, Data: {response.data.decode('utf-8')}")
        except Exception as e:
            print(f"Error sending notification to Google Chat webhook {webhook_url}: {e}")


def lambda_handler(event, context):
    """월간 온콜 엔지니어 계획을 생성하고 결과를 저장하는 메인 함수

    event 파라미터:
    - time (str, optional): 대상 월의 기준 시간 (ISO 8601). 미설정 시 현재 시간 사용.
    """
    print("Starting monthly on-call allocation...")

    if not ENGINEERS or len(ENGINEERS) < 2:
        print("Error: ENGINEER_LIST environment variable must contain at least 2 engineers.")
        return {"statusCode": 400, "body": "Insufficient number of engineers."}

    if BACKEND_ENGINEERS:
        print(f"Role-aware allocation enabled. Backend engineers: {sorted(BACKEND_ENGINEERS)}")
    else:
        print("BACKEND_ENGINEERS not set — falling back to count-based allocation without role constraint.")

    # EventBridge에서 전달된 시간 또는 현재 시간 사용
    time_str = event.get("time")
    if time_str:
        execution_time = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
    else:
        execution_time = datetime.utcnow()

    year, month = execution_time.year, execution_time.month

    # 월간 계획 생성
    monthly_plan = generate_monthly_plan(ENGINEERS, BACKEND_ENGINEERS, year, month)
    print(f"Generated monthly plan for {year}-{month}: {monthly_plan}")

    # DynamoDB에 결과 저장
    try:
        with oncall_table.batch_writer() as batch:
            for week_plan in monthly_plan:
                assignment_date = datetime.strptime(week_plan['week'].split(' ~ ')[0], '%Y.%m.%d').isoformat()
                batch.put_item(Item={"AssignmentDate": f"{assignment_date}-primary", "Engineer": week_plan['primary'], "Role": "Primary"})
                batch.put_item(Item={"AssignmentDate": f"{assignment_date}-secondary", "Engineer": week_plan['secondary'], "Role": "Secondary"})
        print("Successfully saved monthly assignments to DynamoDB.")
    except Exception as e:
        print(f"Error saving assignments to DynamoDB: {e}")
        return {"statusCode": 500, "body": "Failed to save assignments."}

    # Google Calendar에 이벤트 동기화
    sync_to_google_calendar(monthly_plan, year, month)

    # Google Chat으로 알림 전송
    send_google_chat_notification(monthly_plan, year, month)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": "Monthly on-call allocation successful!",
            "plan": monthly_plan
        })
    }
