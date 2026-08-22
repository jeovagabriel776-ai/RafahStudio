RAFAHSTUDIO — ATUALIZAÇÃO COM CATÁLOGO

1. Substitua os arquivos do GitHub pelos arquivos desta pasta.
2. No Supabase > SQL Editor, execute o arquivo supabase_setup.sql inteiro (ou apenas o bloco CATÁLOGO DE REFERÊNCIAS se o SQL anterior já estiver instalado).
3. Não é necessário recriar o projeto Supabase.

Novidades:
- Remoção de clientes cadastrados (sem apagar pedidos).
- Catálogo do designer.
- Arte aprovada/paga pode ser adicionada ao catálogo a partir do pedido.
- Catálogo é armazenado no Supabase e fica disponível no briefing público.
- Cliente pode selecionar uma ou mais artes como referência.
- A seleção aparece no briefing recebido pelo designer.
- Interface de marca usa apenas o espaço da logo SVG, sem texto fixo de nome junto à logo.
- Edição e remoção de itens do catálogo.

IMPORTANTE: o arquivo supabase_setup.sql desta versão contém o bloco necessário para criar catalog_items e as funções RPC do catálogo.
