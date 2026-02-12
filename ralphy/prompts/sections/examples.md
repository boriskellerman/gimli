## Examples & Patterns

**Use existing code as your primary reference.** Before writing new code, find a similar existing implementation and follow its patterns.

### Pattern Discovery
```bash
# Find similar implementations
grep -rn "class.*extends\|export function\|export const" src/module/ --include="*.ts"

# See how tests are structured
cat src/module/existing.test.ts

# Check how errors are handled in this module
grep -rn "throw\|catch\|Error" src/module/ --include="*.ts" | head -10
```

### Common Gimli Patterns

**Channel Plugin Pattern:**
```
src/channels/plugins/actions/<channel>.ts   — Button/reaction handling
src/channels/plugins/normalize/<channel>.ts — Message normalization
src/channels/plugins/outbound/<channel>.ts  — Sending messages
src/channels/plugins/status-issues/<channel>.ts — Health checks
```

**Config Extension Pattern:**
```
src/config/types.<feature>.ts  — TypeScript types
src/config/config.<feature>.test.ts — Config validation tests
```

**Tool Pattern:**
```
src/agents/tools/<name>.ts      — Tool implementation
src/agents/tools/<name>.test.ts — Tool tests
```

### When No Pattern Exists
If you're building something truly new:
1. Write a minimal working version first
2. Add types
3. Add tests
4. Refine based on validation
