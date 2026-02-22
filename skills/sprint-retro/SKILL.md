# Sprint Retrospective

Generate a sprint retrospective report with velocity metrics and task categorization.

## Trigger

User says: "sprint retro", "retrospective", "sprint review", "sprint report"

## Steps

1. **Fetch retrospective data** using the `notion_sprint_retro` MCP tool:
   - Call `mcp__plugin_codepresso_notion__notion_sprint_retro` with no arguments (uses current sprint)
   - This returns velocity metrics, contributor stats, and task categories

2. **Display the retrospective report:**

### Sprint Summary
```
## Sprint Retrospective: "{sprint.name}"
Period: {dateRange.start} → {dateRange.end}
```

### Velocity Metrics
```
### Velocity
- Total Tasks: {velocity.totalTasks}
- Completed: {velocity.completedTasks} ({velocity.completionRate}%)
- Blocked: {velocity.blockedTasks}
- Remaining: {velocity.remainingTasks}
```

### Epic Progress
For each epic:
```
### [{epic.uniqueId}] {epic.title}
Progress: {completedCount}/{totalCount} tasks ({completionPct}%)
Status: {epic.status}
```

### Contributor Summary
```
### Team Contributions
| Member | Completed | In Progress | Total |
|--------|-----------|-------------|-------|
| {name} | {completed} | {inProgress} | {total} |
```

### Category Breakdown
```
### Task Categories
| Category | Count |
|----------|-------|
| {category} | {count} |
```

3. **Suggest action items** based on the data:
   - If completion rate < 70%: "Consider reducing sprint scope or addressing blockers"
   - If blocked tasks > 20% of total: "High block rate — review dependencies"
   - If any epic is at 0%: "Epic {name} has no progress — reassess priority"

4. **If retrospective data unavailable:**
   - Check if sprint workflow is configured
   - Suggest running `/codepresso:setup` if not configured

## Notes
- This skill generates a read-only report from Notion data
- Best used at the end of a sprint for review meetings
- All data comes from the `notion_sprint_retro` MCP tool
