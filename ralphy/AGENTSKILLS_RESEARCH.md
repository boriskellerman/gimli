# AgentSkills.io Platform Research

## Overview

**AgentSkills.io** is a documentation site for the **Agent Skills** open format, originally developed by Anthropic and released as an open standard. The format provides a simple, portable way to give AI agents new capabilities and specialized knowledge.

**Core concept**: Agent Skills are folders of instructions, scripts, and resources that agents can discover and use to perform tasks more accurately and efficiently.

**GitHub Repository**: https://github.com/agentskills/agentskills

## Why Agent Skills?

Agents are increasingly capable but often lack the context needed for reliable work. Skills solve this by providing:

1. **Procedural knowledge**: Step-by-step instructions for specific tasks
2. **Domain expertise**: Specialized knowledge in portable packages
3. **Context on demand**: Information loaded only when relevant

### Value Propositions

| Stakeholder | Benefit |
|-------------|---------|
| **Skill Authors** | Build capabilities once, deploy across multiple agent products |
| **Agent Products** | Support skills to let users extend capabilities out of the box |
| **Teams/Enterprises** | Capture organizational knowledge in version-controlled packages |

## Adoption

Agent Skills are supported by major AI development tools including:

- Claude Code, Claude.ai, OpenAI Codex
- Cursor, VS Code, GitHub
- Gemini CLI, Goose, Roo Code
- Amp, Factory, Databricks
- Mistral AI Vibe, and many more

## Skill Architecture

### Directory Structure

A skill is a directory containing at minimum a `SKILL.md` file:

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: additional documentation
└── assets/           # Optional: templates, images, data files
```

### SKILL.md Format

The `SKILL.md` file contains YAML frontmatter followed by Markdown content:

```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents.
license: Apache-2.0
compatibility: Requires poppler-utils for PDF operations
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read
---

# PDF Processing

## When to use this skill
Use this skill when the user needs to work with PDF files...

## How to extract text
1. Use pdfplumber for text extraction...
```

### Frontmatter Fields

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Max 64 chars. Lowercase letters, numbers, hyphens only. Must match parent directory name. |
| `description` | Yes | Max 1024 chars. Non-empty. Describes what skill does and when to use it. |
| `license` | No | License name or reference to bundled license file |
| `compatibility` | No | Max 500 chars. Environment requirements (products, packages, network access) |
| `metadata` | No | Arbitrary key-value pairs for additional properties |
| `allowed-tools` | No | Space-delimited list of pre-approved tools (experimental) |

### Name Field Rules

- 1-64 characters
- Unicode lowercase alphanumeric and hyphens only (`a-z`, `-`)
- Cannot start or end with `-`
- No consecutive hyphens (`--`)
- Must match parent directory name

**Valid examples**: `pdf-processing`, `data-analysis`, `code-review`

**Invalid examples**: `PDF-Processing` (uppercase), `-pdf` (starts with hyphen), `pdf--processing` (consecutive hyphens)

## Progressive Disclosure Model

Skills use a three-tier loading system to manage context efficiently:

### Token Loading Tiers

1. **Metadata (~100 tokens)**: `name` and `description` loaded at startup for ALL skills
2. **Instructions (< 5000 tokens recommended)**: Full `SKILL.md` body loaded when skill is activated
3. **Resources (as needed)**: Files in `scripts/`, `references/`, `assets/` loaded only when required

### Benefits

- Agents stay fast with minimal startup overhead
- Context window is used efficiently
- Agents can access extensive resources on demand
- Large reference materials don't consume tokens until accessed

## How Skills Work (Runtime)

### 1. Discovery Phase
At startup, agents scan configured directories for valid skills (folders containing `SKILL.md`).

### 2. Metadata Loading
Parse only YAML frontmatter from each `SKILL.md`. Include skill metadata in system prompt so the model knows available capabilities.

**Recommended format for Claude models (XML)**:
```xml
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>Extracts text and tables from PDF files...</description>
    <location>/path/to/skills/pdf-processing/SKILL.md</location>
  </skill>
</available_skills>
```

### 3. Activation
When a task matches a skill's description, the agent reads the full `SKILL.md` instructions into context.

### 4. Execution
The agent follows instructions, optionally:
- Loading referenced files from `references/`
- Executing bundled scripts from `scripts/`
- Accessing assets from `assets/`

## Integration Approaches

### Filesystem-based Agents
- Operate within a computer environment (bash/unix)
- Skills activated when model issues shell commands like `cat /path/to/skill/SKILL.md`
- Bundled resources accessed through shell commands
- Most capable option

### Tool-based Agents
- Function without a dedicated computer environment
- Implement custom tools to trigger skills and access bundled assets
- Specific implementation is developer-defined

## Optional Directories

### scripts/
Contains executable code that agents can run:
- Should be self-contained or clearly document dependencies
- Include helpful error messages
- Handle edge cases gracefully
- Supported languages depend on agent implementation

### references/
Contains additional documentation loaded on demand:
- `REFERENCE.md` - Detailed technical reference
- `FORMS.md` - Form templates or structured data
- Domain-specific files (`finance.md`, `legal.md`, etc.)

### assets/
Contains static resources:
- Templates (document, configuration)
- Images (diagrams, examples)
- Data files (lookup tables, schemas)

## Best Practices

### Description Writing

**Do**:
- Write in third person ("Processes Excel files...")
- Be specific and include key terms
- Include both WHAT it does and WHEN to use it
- Use trigger words users would mention

**Don't**:
- Use first/second person ("I can help you...")
- Be vague ("Helps with documents")
- Omit activation triggers

### Naming Conventions

Use gerund form (verb + -ing) for clarity:
- `processing-pdfs`
- `analyzing-spreadsheets`
- `managing-databases`

Avoid vague names: `helper`, `utils`, `tools`

### Content Guidelines

1. **Keep SKILL.md under 500 lines**
2. **Be concise** - Claude is already smart; only add context it doesn't have
3. **Use consistent terminology** throughout
4. **Avoid time-sensitive information**
5. **Keep file references one level deep** from SKILL.md
6. **Use Unix-style paths** (forward slashes) always

### Structure for Longer Reference Files

Include table of contents for files > 100 lines:
```markdown
# API Reference

## Contents
- Authentication and setup
- Core methods
- Advanced features
- Error handling
- Code examples

## Authentication and setup
...
```

## Skill Patterns

### Template Pattern
Provide output format templates:
```markdown
## Report structure
ALWAYS use this exact template:

# [Analysis Title]
## Executive summary
[One-paragraph overview]
## Key findings
- Finding 1
- Finding 2
```

### Examples Pattern
Show input/output pairs for quality-dependent tasks:
```markdown
**Example:**
Input: Added user authentication with JWT tokens
Output:
feat(auth): implement JWT-based authentication
```

### Workflow Pattern
Break complex operations into sequential steps with checklists:
```markdown
Task Progress:
- [ ] Step 1: Analyze the form
- [ ] Step 2: Create field mapping
- [ ] Step 3: Validate mapping
- [ ] Step 4: Fill the form
```

### Feedback Loop Pattern
Run validator → fix errors → repeat:
```markdown
1. Make edits
2. Validate immediately: `python validate.py`
3. If validation fails: fix issues, validate again
4. Only proceed when validation passes
```

## Reference Implementation

The `skills-ref` Python library provides utilities for working with skills:

**Installation**: Via pip or uv package manager

**CLI Commands**:
```bash
# Validate a skill directory
skills-ref validate path/to/skill

# Read skill properties (returns JSON)
skills-ref read-properties path/to/skill

# Generate <available_skills> XML for prompts
skills-ref to-prompt path/to/skill-a path/to/skill-b
```

**Python API**:
```python
from skills_ref import validate, read_properties, to_prompt

# Validate skill
problems = validate(Path("./my-skill"))

# Read properties
props = read_properties(Path("./my-skill"))  # name, description

# Generate prompt XML
xml = to_prompt([Path("./skill-a"), Path("./skill-b")])
```

## Security Considerations

When integrating skills with script execution:

1. **Sandboxing**: Run scripts in isolated environments
2. **Allowlisting**: Only execute scripts from trusted skills
3. **Confirmation**: Ask users before dangerous operations
4. **Logging**: Record all script executions for auditing

## Example Skills Repository

Anthropic maintains example skills at: https://github.com/anthropics/skills

### Available Skill Categories
- **Creative & Design skills**
- **Development & Technical skills**
- **Enterprise & Communication skills**
- **Document Skills**: docx, pdf, pptx, xlsx (production-grade)

### Claude Code Installation
```bash
/plugin marketplace add anthropics/skills
/plugin install document-skills@anthropic-agent-skills
/plugin install example-skills@anthropic-agent-skills
```

## Key Takeaways

1. **Skills are simple**: Just a folder with a `SKILL.md` file
2. **Progressive disclosure**: Metadata at startup, full content on activation
3. **Portable**: Works across multiple agent products
4. **Version-controlled**: Easy to track, share, and collaborate
5. **Extensible**: Range from text instructions to executable code
6. **Self-documenting**: Human-readable format aids auditing

## Resources

- **Documentation**: https://agentskills.io
- **Specification**: https://agentskills.io/specification
- **Integration Guide**: https://agentskills.io/integrate-skills
- **Best Practices**: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- **Main Repository**: https://github.com/agentskills/agentskills
- **Example Skills**: https://github.com/anthropics/skills
- **Reference Library**: https://github.com/agentskills/agentskills/tree/main/skills-ref
