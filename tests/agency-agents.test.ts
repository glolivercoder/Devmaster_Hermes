import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAgencyAgentSummary,
  parseAgencyAgentMarkdown,
} from '../src/memory/agency-agents.js';

const PROFILE = `---
name: API Platform Engineer
description: Designs and maintains reliable APIs and developer platforms.
vibe: Makes APIs predictable and easy to operate.
---

# API Platform Engineer

## 🎯 Your Core Mission

### API Lifecycle Management
- Design versioned APIs and consistent contracts.
- Improve developer onboarding.

### Platform Reliability
- Establish service health and operational standards.
`;

test('parses supported Agency Agents profile metadata and mission areas', () => {
  const profile = parseAgencyAgentMarkdown(
    'engineering/engineering-api-platform-engineer.md',
    'engineering',
    'abc123',
    PROFILE,
  );

  assert.equal(profile.name, 'API Platform Engineer');
  assert.equal(profile.division, 'engineering');
  assert.deepEqual(profile.capabilityAreas, ['API Lifecycle Management', 'Platform Reliability']);
  assert.equal(profile.sourceSha, 'abc123');
});

test('builds attributed RAG reference without treating source profile as executable instructions', () => {
  const profile = parseAgencyAgentMarkdown(
    'engineering/engineering-api-platform-engineer.md',
    'engineering',
    'abc123',
    PROFILE,
  );
  const summary = buildAgencyAgentSummary(profile);

  assert.match(summary, /Designs and maintains reliable APIs/);
  assert.match(summary, /API Lifecycle Management/);
  assert.match(summary, /licença MIT/);
  assert.match(summary, /não instrução executável/);
  assert.doesNotMatch(summary, /Improve developer onboarding/);
});

test('rejects upstream files that do not contain required profile metadata', () => {
  assert.throws(
    () => parseAgencyAgentMarkdown('engineering/readme.md', 'engineering', 'abc123', '# Not an agent profile'),
    /frontmatter YAML válido/,
  );
});
