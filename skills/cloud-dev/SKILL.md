# Cloud Dev Environment

Manage your cloud development EC2 instance directly from Claude Code.

## Triggers

- "cloud dev"
- "start my instance"
- "stop my instance"
- "dev environment"
- "turn on my dev"
- "my ec2"
- "dev server"

## Steps

1. **Check current status** — Call the `cloud_dev_status` MCP tool to get the current state of the user's instance.

2. **Present status and options** — Show the user their instance status, then use `AskUserQuestion` to offer actions:

   If instance is **stopped**:
   - Option 1: "Start instance" — Start the dev environment
   - Option 2: "Show all instances" — List all team instances

   If instance is **running**:
   - Option 1: "Stop instance" — Stop the dev environment
   - Option 2: "Show all instances" — List all team instances

   If **no instance found** or **credentials error**:
   - Show the error message clearly
   - Suggest running `codepresso:setup` or configuring AWS credentials

3. **Execute the chosen action:**

   - **Start**: Call `cloud_dev_start` MCP tool. Report the public IP address when ready.
     Format: "Your instance is now running at `<public-ip>`"
   - **Stop**: Call `cloud_dev_stop` MCP tool. Confirm when stopped.
     Format: "Your instance has been stopped."
   - **Show all**: Call `cloud_dev_list` MCP tool. Display a table of all team instances with columns: Name, Email, State, IP.

4. **After action** — If the user started an instance, remind them about the auto-stop Lambda:
   "Note: Your instance will auto-stop after being idle. No need to manually stop it."

## Requirements

- AWS credentials configured (AWS CLI profile, environment variables, or IAM role)
- EC2 instances tagged with `Purpose=cloud-dev-env` and `Email=<git-email>`
- Region defaults to `ap-northeast-2` (configurable via `cloudDev.region` in `~/.codepresso/config.json`)

## Configuration

The `cloudDev` section in `~/.codepresso/config.json`:

```json
{
  "cloudDev": {
    "enabled": true,
    "region": "ap-northeast-2",
    "tagKey": "Email",
    "purposeTag": "cloud-dev-env"
  }
}
```
