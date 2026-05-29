# @freegamestore/compliance

Compliance checks for games published on **freegamestore.online**. Same checks the CLI runs locally and the template's CI runs on every push.

```ts
import { runChecks } from '@freegamestore/compliance';

const results = await runChecks(process.cwd());
for (const r of results) {
  console.log(`${r.status}  ${r.name}  ${r.detail}`);
  for (const s of r.suggestions ?? []) console.log(`   → ${s}`);
}
```

## License

MIT.
