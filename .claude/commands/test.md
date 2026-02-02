# Test Operations

## Purpose
Run tests for Gimli - from quick checks to comprehensive test suites.

## Available Test Commands

### Quick Tests (Development)
```bash
pnpm test                     # Run all tests
pnpm test <file>              # Run specific test file
pnpm test --watch             # Watch mode
```

### Coverage Tests
```bash
pnpm test:coverage            # Run with V8 coverage
```

### Live Tests (Require Real Credentials)
```bash
GIMLI_LIVE_TEST=1 pnpm test:live         # Gimli-only live tests
LIVE=1 pnpm test:live                     # Include provider live tests
```

### Docker Tests
```bash
pnpm test:docker:live-models    # Live model tests in Docker
pnpm test:docker:live-gateway   # Live gateway tests in Docker
pnpm test:docker:onboard        # Onboarding E2E tests
```

## Test File Conventions
- Unit tests: `*.test.ts` (colocated with source)
- E2E tests: `*.e2e.test.ts`
- Coverage thresholds: 70% lines/branches/functions/statements

## Instructions
Based on the test request, run the appropriate commands:

1. **Quick validation**: `pnpm test`
2. **Specific file**: `pnpm test <path/to/file.test.ts>`
3. **Full suite with coverage**: `pnpm test:coverage`
4. **Live integration**: `GIMLI_LIVE_TEST=1 pnpm test:live`

## Before Running Tests
Ensure dependencies are installed:
```bash
pnpm install
```

## Test Request
$ARGUMENTS
