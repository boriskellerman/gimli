## Validation Rules

After completing your work, self-validate:

1. **No merge conflicts** — Check for `<<<<<<<`, `=======`, `>>>>>>>` markers
2. **Files exist** — Every file you modified should exist and be non-empty
3. **No regressions** — Run `npm test -- --run` and verify no new failures
4. **Code quality** — No `console.log` in production code (use proper logging)
5. **Type safety** — Run `./node_modules/.bin/tsc --noEmit` to verify types

If any validation fails, fix it before reporting completion.
Maximum self-correction attempts: 3.
