# AgentSkills.io Platform Research

## Executive Summary

AgentSkills.io is an open standard developed by Anthropic for giving AI agents new capabilities through structured instruction packages. The format has been adopted by major AI development tools including Claude Code, Cursor, GitHub Copilot, VS Code, Gemini CLI, OpenAI Codex, and many others.

**Key Insight**: Agent Skills are essentially "folders of instructions, scripts, and resources that agents can discover and use to do things more accurately and efficiently."

---

## 1. Platform Overview

### What AgentSkills.io Provides

| Component | Description |
|-----------|-------------|
| **Open Specification** | Defines the SKILL.md format and skill directory structure |
| **Documentation** | Comprehensive guides at agentskills.io |
| **Reference Library** | Python CLI tool (`skills-ref`) for validation and prompt generation |
| **Example Skills** | Reference implementations at github.com/anthropics/skills |
| **Governance** | Maintained by Anthropic, open to community contributions |

### Why Skills Exist

1. **Context Gap Problem**: Agents are capable but lack task-specific procedural knowledge
2. **Progressive Loading**: Skills load context on-demand rather than all upfront
3. **Portability**: Same skill works across different agent products
4. **Version Control**: Skills are just files - easy to version, share, edit

---

## 2. Skill Architecture

### Directory Structure

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: additional documentation
└── assets/           # Optional: templates, static resources
```

### SKILL.md Format

```yaml
---
name: skill-name
description: What the skill does and when to use it
license: Apache-2.0
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read
---

# Skill Title

## Instructions
Step-by-step guidance for the agent...

## Examples
Input/output examples...

## References
Links to bundled files like [reference.md](references/reference.md)
```

### Field Constraints

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Max 64 chars, lowercase + hyphens only, must match directory name |
| `description` | Yes | Max 1024 chars, describes what + when to use |
| `license` | No | License name or reference to bundled file |
| `compatibility` | No | Max 500 chars, environment requirements |
| `metadata` | No | Arbitrary key-value pairs |
| `allowed-tools` | No | Pre-approved tools (experimental) |

---

## 3. Progressive Disclosure Model

The architecture is designed to efficiently manage context:

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Discovery (~100 tokens/skill)                      │
│ - Only name + description loaded at startup                 │
│ - Agent sees what skills are available                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Activation (<5000 tokens recommended)              │
│ - Full SKILL.md body loaded when skill matches task         │
│ - Agent receives complete instructions                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 3: Resources (as needed)                              │
│ - Files in scripts/, references/, assets/ loaded on demand  │
│ - Scripts executed without loading source into context      │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle**: Keep SKILL.md under 500 lines. Move detailed reference material to separate files.

---

## 4. Agent Integration Approaches

### Filesystem-Based Agents (Most Capable)

```
1. Agent has bash/unix environment access
2. Skills discovered by scanning configured directories
3. Activation: model issues `cat /path/to/skill/SKILL.md`
4. Resources accessed through shell commands
```

### Tool-Based Agents

```
1. Agent has no dedicated filesystem access
2. Skills loaded through custom tool implementations
3. Developer defines how skills are triggered and accessed
```

### System Prompt Injection

Skills metadata injected as XML in system prompt:

```xml
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>Extracts text and tables from PDF files...</description>
    <location>/path/to/skills/pdf-processing/SKILL.md</location>
  </skill>
</available_skills>
```

---

## 5. Authoring Best Practices

### Description Writing

**Good**:
```yaml
description: Extract text and tables from PDF files, fill forms, merge documents.
Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

**Bad**:
```yaml
description: Helps with documents
```

### Degrees of Freedom

| Freedom Level | When to Use | Example |
|---------------|-------------|---------|
| **High** (text instructions) | Multiple valid approaches, context-dependent | Code review guidelines |
| **Medium** (scripts with params) | Preferred pattern exists with variation | Report generation templates |
| **Low** (specific scripts) | Fragile operations, consistency critical | Database migrations |

### Naming Conventions

Recommended: **Gerund form** (verb + -ing)
- `processing-pdfs`
- `analyzing-spreadsheets`
- `testing-code`

Avoid:
- Vague: `helper`, `utils`, `tools`
- Generic: `documents`, `data`, `files`
- Reserved words: `anthropic-*`, `claude-*`

### Workflow Pattern

```markdown
## PDF Form Filling Workflow

Copy this checklist and track progress:

```
Task Progress:
- [ ] Step 1: Analyze the form (run analyze_form.py)
- [ ] Step 2: Create field mapping (edit fields.json)
- [ ] Step 3: Validate mapping (run validate_fields.py)
- [ ] Step 4: Fill the form (run fill_form.py)
- [ ] Step 5: Verify output (run verify_output.py)
```
```

### Feedback Loop Pattern

```markdown
## Document Editing Process

1. Make edits to document.xml
2. **Validate immediately**: python validate.py
3. If validation fails: fix issues → run validation again
4. **Only proceed when validation passes**
5. Rebuild and test output
```

---

## 6. Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Windows paths | Breaks on Unix | Use forward slashes always |
| Too many options | Confuses agent | Provide default with escape hatch |
| Time-sensitive info | Becomes stale | Use "old patterns" section |
| Inconsistent terminology | Confuses agent | Pick one term per concept |
| Deeply nested references | Partial reads | Keep references one level deep |
| Verbose explanations | Wastes tokens | Assume agent intelligence |
| Magic numbers | Unclear intent | Document all constants |

---

## 7. Reference Library (skills-ref)

### Installation
```bash
pip install skills-ref
# or
uv pip install skills-ref
```

### CLI Commands

```bash
# Validate skill structure
skills-ref validate ./my-skill

# Extract metadata as JSON
skills-ref read-properties ./my-skill

# Generate system prompt XML
skills-ref to-prompt ./skill-a ./skill-b
```

### Python API

```python
from skills_ref import validate, read_properties, to_prompt

# Validate skill directory
issues = validate("./my-skill")

# Read metadata
metadata = read_properties("./my-skill")

# Generate prompt XML
xml = to_prompt(["./skill-a", "./skill-b"])
```

**Note**: Library is for demonstration; not recommended for production.

---

## 8. Ecosystem Adoption

### Major Adopters (as of 2025)

| Category | Products |
|----------|----------|
| **AI Coding Tools** | Claude Code, Cursor, VS Code, OpenAI Codex, Gemini CLI, Roo Code |
| **Agent Frameworks** | Goose, Letta, Spring AI, Amp, Factory |
| **Development Platforms** | GitHub, Databricks, Mux |

### Adoption Benefits

- **For skill authors**: Build once, deploy across multiple products
- **For agents**: Extensible capabilities via user-installed skills
- **For enterprises**: Capture organizational knowledge in portable packages

---

## 9. Comparison to Claude Code Skills

### Similarities
- Both use SKILL.md with YAML frontmatter
- Progressive disclosure model
- Can bundle scripts and resources

### Differences

| Feature | AgentSkills.io Spec | Claude Code Implementation |
|---------|---------------------|---------------------------|
| Discovery | Filesystem scan | Plugin system + local ~/.claude/skills |
| Invocation | Agent decides | /skill-name command or auto-trigger |
| Permissions | `allowed-tools` field | Interactive permission prompts |
| Metadata | Generic `metadata` map | Specific fields in frontmatter |

---

## 10. Key Takeaways for Implementation

1. **Structure Skills for Progressive Loading**: Metadata → Instructions → Resources
2. **Write Specific Descriptions**: Include both what AND when to use
3. **Keep SKILL.md Concise**: Under 500 lines, reference external files
4. **Use Checklists for Workflows**: Help agent track multi-step progress
5. **Include Validation Steps**: Catch errors before they propagate
6. **Test with Target Models**: Skill effectiveness varies by model capability
7. **Iterate with Evaluations**: Create test scenarios before writing extensive docs

---

## References

- Specification: https://agentskills.io/specification
- Best Practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Example Skills: https://github.com/anthropics/skills
- Reference Library: https://github.com/agentskills/agentskills/tree/main/skills-ref
- GitHub Repository: https://github.com/agentskills/agentskills
