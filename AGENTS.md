# Campaign Planner development

This is a Jo application using Harpe on Python.
This file guides development. Runtime instructions belong in
[prompts/plan.md](prompts/plan.md). Treat runtime prompts and skills as
application content.

## Commands

Run commands from the project root. See [README.md](README.md) for configuration.
Activate the environment in each shell before installing dependencies or running Jo.

- Create a virtual environment if missing: `python3 -m venv .venv`.
- Activate it: `. .venv/bin/activate`.
- Install dependencies: `python -m pip install -r requirements.txt`.
- Build the application: `jo build agent`.
- Build the sandbox: `jo build --spec sandbox/jo.toml guest`.
- Run the web application after configuration: `jo start`.
- Run tests: `jo exec test`. This builds the sandbox before running the suite.
  No provider API key is needed.

Run the smallest affected check first. Run the suite after behavior changes.
Inspect the diff before handing off. Report checks run and any that could not run.

## Development conventions

- Prefer colon call syntax for multiline and nested calls.
- Use [skills/jo-syntax.md](skills/jo-syntax.md) when writing Jo.
- Expose customer labels scoped to the current run.
  Keep names, emails, addresses, and delivery notes out of model inputs and guest data.
- Keep guest writes limited to draft coupons. Approval belongs to the owner.
- Enforce budget and offer limits in `PromotionsImpl`.
  Save each batch of drafts in one transaction. Reject the whole batch on failure.
- Represent money as integer cents.
- Keep Python FFI out of the API and guest modules.
  Expose database access through capabilities implemented in the trusted runtime.
- Change capability APIs, runtime bindings, and the `runTask` placeholder together.
  Update affected prompt examples.
- Keep [skills/api.jo](skills/api.jo) and
  [examples/late-regulars.jo](examples/late-regulars.jo) in sync with capability changes.
- Preserve loopback binding and host checks. The application has no login.
- Do not edit generated `.build/` output.
- If Jo or Harpe crashes or appears to have a bug, reduce it to a small
  reproduction and submit an issue with the reproduction and version details.

## References

- [Jo documentation](https://jo-lang.org/): syntax, capabilities, and build commands.
- [Jo GitHub](https://github.com/typescope/jo): implementation and tests.
- [Harpe documentation](https://harpe.typescope.ai/): concepts and extension patterns.
- [Harpe GitHub](https://github.com/typescope/harpe): APIs, examples, and tests.

Use local examples first. Consult documentation and source when unsure.
Check [jo.toml](jo.toml) and [sandbox/jo.toml](sandbox/jo.toml) for declared versions.
Use `jo.lock` files for resolved package versions.
Read source at the matching release tag or commit.
Current documentation and `main` may describe newer APIs.
