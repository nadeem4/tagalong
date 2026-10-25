# Contract examples

Sample JSON-RPC frames for contract v1, shared by the TypeScript and Python tests. Each file is one full frame.
Valid files are `valid/<from>.<method>.<kind>[.<variant>].json`; invalid ones are `invalid/<from>.<method>.<kind>.<why>.json`.
`<from>` is `body` or `brain`: the side that sends the request or notification (`cancel` exists both ways).
`<kind>` is `params`, `result` or `error`; for a result or error frame, `<from>` and `<method>` name the request being answered.
Each test checks the `params`, `result` or `error` of the frame against its schema: valid files must pass, invalid files must fail.
