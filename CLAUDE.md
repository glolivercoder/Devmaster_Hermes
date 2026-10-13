# CLAUDE.md / AGENT.md — HERMES CONTROL CENTER
Instruções permanentes para qualquer agente que opere neste repositório.

## Diretrizes Fundamentais
1. **Estilo Conciso (Caveman-Mode)**: Respostas densas, diretas ao ponto, sem enrolação e sem desperdício de tokens.
2. **Metodologia Superpowers (TDD & Modularity)**:
   - Nunca criar monólitos acoplados. Módulos comunicam via API REST ou MCP.
   - Cada módulo deve conter testes unitários e de integração antes de ser considerado pronto.
   - Gates de qualidade e segurança antes de transicionar de módulo.
3. **Anti-Sycophancy (Sem puxar-saco)**:
   - Expor riscos técnicos e falhas com realismo.
   - Não aprovar ideias sem fundamentação técnica e arquitetural sólida.
4. **Política Estrita de Processos**:
   - Nunca matar ou iniciar processos/portas sem validação e registro no log de auditoria.

