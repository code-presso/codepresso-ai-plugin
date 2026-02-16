---
name: deploy
description: Trigger deployment to AWS (optional, team-configurable)
trigger: "deploy", "trigger deploy", "deploy to"
---

# Deploy Skill

Trigger a deployment from within your Claude Code session. **This feature is optional** — each team configures their own deploy strategy.

## Prerequisites

Deploy must be enabled in config. Check `~/.codepresso/config.json` or `.codepresso.json`:

```json
{
  "deploy": {
    "enabled": true,
    "method": "ecs" | "codepipeline" | "workflow" | "custom",
    "awsRegion": "ap-northeast-2",
    "ecsCluster": "my-cluster",
    "ecsService": "my-service",
    "pipelineName": "my-pipeline",
    "workflowFile": "deploy.yml",
    "customCommand": "make deploy ENV=$ENV"
  }
}
```

## Usage

### Step 1: Check if deploy is configured

```bash
# Read config
cat .codepresso.json 2>/dev/null || cat ~/.codepresso/config.json 2>/dev/null
```

If `deploy.enabled` is not `true`, tell the user:
> Deploy is not configured for this project. Add a `deploy` section to `.codepresso.json` or run `codepresso:setup` to configure.

Then offer to help them set it up by asking:
- What's your deploy method? (ECS, CodePipeline, GitHub Actions workflow, custom script)
- What are the required parameters? (cluster, service, pipeline name, etc.)

### Step 2: Detect deploy method

Check `deploy.method` in config:

| Method | Description |
|--------|-------------|
| `ecs` | Direct ECS deployment via AWS CLI or `gh workflow run` |
| `codepipeline` | Trigger AWS CodePipeline |
| `workflow` | Trigger any GitHub Actions workflow by name |
| `custom` | Run a custom deploy command |

If no method configured, auto-detect:
```bash
ls .github/workflows/deploy*.yml 2>/dev/null
```

### Step 3: Ask environment (if applicable)

Ask the user which environment to deploy to (staging / production).

### Step 4: Execute deployment

**Method: `ecs`**
```bash
# Via GitHub Actions (preferred)
gh workflow run deploy-ecs.yml -f environment=<env>

# Or direct AWS CLI
aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment --region <region>
```

**Method: `codepipeline`**
```bash
# Via GitHub Actions
gh workflow run deploy-codepipeline.yml

# Or direct AWS CLI
aws codepipeline start-pipeline-execution --name <pipeline> --region <region>
```

**Method: `workflow`**
```bash
gh workflow run <workflow-file> -f environment=<env>
```

**Method: `custom`**
```bash
# Run the team's custom command (with ENV variable substituted)
<customCommand with $ENV replaced>
```

### Step 5: Report

If on a PR branch, post deployment status:
```bash
gh pr comment <number> --body "### 🚀 Deployment Triggered

**Environment:** \`<env>\`
**Method:** <method>
**Triggered by:** Claude Code session

---
<sub>Deployed via Codepresso</sub>"
```

### Step 6: Handle errors

- Show error output
- If deploy not configured: help user set it up
- If AWS credentials missing: suggest `aws configure` or checking GitHub secrets
- Offer to check logs: `aws logs tail /ecs/<service> --since 5m`
