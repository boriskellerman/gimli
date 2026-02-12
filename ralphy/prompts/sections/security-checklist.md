## Security Checklist

**Run through this before any change that touches user input, auth, or data:**

- [ ] No credentials in source code (use environment variables or `pass`)
- [ ] No `console.log` of sensitive data (tokens, passwords, PII)
- [ ] External input is validated before use
- [ ] No SQL injection vectors (use parameterized queries)
- [ ] No command injection (no `exec(userInput)`)
- [ ] File paths are sanitized (no path traversal)
- [ ] Error messages don't leak internal details to users
- [ ] New dependencies are from trusted publishers
- [ ] No `eval()`, `Function()`, or `vm.runInNewContext()` with user input
- [ ] Rate limiting considered for new endpoints/handlers
- [ ] Auth checks present on new routes/commands
- [ ] Permissions follow principle of least privilege

**If any check fails, fix it before continuing.**
