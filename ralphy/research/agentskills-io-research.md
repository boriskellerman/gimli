# AgentSkills.io Platform Research

## Overview

AgentSkills.io is an **open format specification** for extending AI agent capabilities with specialized knowledge and workflows. Originally developed by **Anthropic** and released as an open standard, it has been adopted by a growing ecosystem of agent products.

**Website**: https://agentskills.io
**GitHub**: https://github.com/anthropics/skills (60.2k+ stars)
**Specification**: https://github.com/agentskills/agentskills

## What Are Agent Skills?

Agent Skills are **folders of instructions, scripts, and resources** that agents can discover and use to perform tasks more accurately and efficiently. They provide:

- **Procedural knowledge** - Step-by-step instructions for specific tasks
- **Context** - Company-, team-, and user-specific information
- **Capabilities** - New abilities agents can load on demand

## Skill Architecture

### Directory Structure

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code (Python, Bash, JS)
├── references/       # Optional: additional documentation
└── assets/           # Optional: templates, images, data files
```

### SKILL.md Format

The core of every skill is a `SKILL.md` file with YAML frontmatter and Markdown content:

```yaml
---
name: pdf-processing                    # Required: 1-64 chars, lowercase, hyphens
description: Extract text from PDFs...  # Required: 1-1024 chars, describes what + when
license: Apache-2.0                     # Optional
compatibility: Requires git, docker     # Optional: 1-500 chars
metadata:                               # Optional: arbitrary key-value pairs
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read         # Optional, experimental
---

# PDF Processing

## When to use this skill
Use this skill when...

## How to extract text
1. Use pdfplumber for text extraction...
```

### Frontmatter Fields

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Max 64 chars. Lowercase letters, numbers, hyphens only. Must match directory name. |
| `description` | Yes | Max 1024 chars. Describes what + when to use. |
| `license` | No | License name or bundled file reference |
| `compatibility` | No | Max 500 chars. Environment requirements |
| `metadata` | No | Arbitrary key-value mapping |
| `allowed-tools` | No | Space-delimited pre-approved tools (experimental) |

### Name Field Rules

- 1-64 characters
- Lowercase alphanumeric + hyphens only (`a-z`, `0-9`, `-`)
- Cannot start/end with hyphen
- No consecutive hyphens (`--`)
- Must match parent directory name

## Progressive Disclosure Pattern

Skills use a **3-tier progressive disclosure** approach to manage context efficiently:

1. **Metadata** (~100 tokens) - `name` and `description` loaded at startup for all skills
2. **Instructions** (<5000 tokens recommended) - Full `SKILL.md` body loaded when skill activates
3. **Resources** (as needed) - Files in `scripts/`, `references/`, `assets/` loaded only when required

**Best Practice**: Keep main `SKILL.md` under 500 lines. Move detailed reference material to separate files.

## How Skills Work

### Lifecycle

1. **Discovery** - At startup, agents scan configured directories for valid skills (folders with `SKILL.md`)
2. **Load Metadata** - Parse only frontmatter of each skill to know when it might be relevant
3. **Activation** - When a task matches a skill's description, load full `SKILL.md` instructions into context
4. **Execution** - Agent follows instructions, optionally loading referenced files or executing bundled scripts

### Integration Approaches

**Filesystem-based agents** (most capable):
- Operate within a computer environment (bash/unix)
- Activate skills via shell commands like `cat /path/to/my-skill/SKILL.md`
- Access bundled resources through shell commands

**Tool-based agents**:
- Function without dedicated computer environment
- Implement tools allowing models to trigger skills and access bundled assets

### System Prompt Injection

For Claude models, the recommended format uses XML:

```xml
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>Extracts text and tables from PDF files...</description>
    <location>/path/to/skills/pdf-processing/SKILL.md</location>
  </skill>
</available_skills>
```

## Ecosystem Adoption

Agent Skills are supported by major AI development tools:

**First-tier adopters**: Claude Code, Claude.ai, Cursor, GitHub Copilot, VS Code
**Other adopters**: Roo Code, Amp, OpenCode, Mistral AI Vibe, Databricks, OpenAI Codex, Gemini CLI, Spring AI, Factory, Goose, and many more

## Reference Implementation

The `skills-ref` library (Python) provides utilities for working with skills:

```bash
# Validate a skill directory
skills-ref validate ./my-skill

# Generate <available_skills> XML for agent prompts
skills-ref to-prompt <path>...
```

GitHub: https://github.com/agentskills/agentskills/tree/main/skills-ref

## Example Skills from Anthropic

The `anthropics/skills` repository contains production examples:

**Document Skills** (source-available):
- `skills/docx` - Word document creation/editing
- `skills/pdf` - PDF processing
- `skills/pptx` - PowerPoint generation
- `skills/xlsx` - Excel spreadsheet handling

**Example Skills** (Apache 2.0):
- Creative & Design skills
- Development & Technical skills
- Enterprise & Communication skills

## Security Considerations

When integrating skills with script execution:

- **Sandboxing** - Run scripts in isolated environments
- **Allowlisting** - Only execute scripts from trusted skills
- **Confirmation** - Ask users before running potentially dangerous operations
- **Logging** - Record all script executions for auditing

## Key Takeaways

1. **Simple format** - Just a folder with a `SKILL.md` file
2. **Progressive disclosure** - Efficient context management with tiered loading
3. **Portable** - Skills are files, easy to version and share
4. **Open standard** - Developed by Anthropic but adopted across ecosystem
5. **Extensible** - From simple instructions to complex script bundles

## Comparison to Claude Code Plugins

| Aspect | Agent Skills | Claude Code Plugins |
|--------|--------------|---------------------|
| Core file | `SKILL.md` | `plugin.json` + components |
| Scope | Single capability/workflow | Full extension system |
| Components | Instructions + scripts + assets | Skills + hooks + commands + agents |
| Discovery | Directory scan for `SKILL.md` | `plugin.json` manifest |
| Ecosystem | Cross-agent interoperability | Claude Code specific |

Agent Skills are focused on **portable, reusable capabilities** while Claude Code Plugins provide a **full extension framework** with hooks, commands, and subagents.

## Resources

- Specification: https://agentskills.io/specification
- What are skills?: https://agentskills.io/what-are-skills
- Integrate skills: https://agentskills.io/integrate-skills
- Example skills: https://github.com/anthropics/skills
- Reference library: https://github.com/agentskills/agentskills/tree/main/skills-ref
- Best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
