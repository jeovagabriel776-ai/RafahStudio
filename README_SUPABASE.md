# RafahStudio — Briefing online com Supabase

Esta versão mantém o RafahStudio em HTML/CSS/JavaScript puro e adiciona o envio real do briefing para o Supabase.

## 1. Configuração no Supabase

1. Abra o projeto `RafahStudio`.
2. Vá em **SQL Editor**.
3. Crie uma nova query.
4. Abra `supabase_setup.sql` deste pacote e copie todo o conteúdo.
5. Cole no SQL Editor e clique em **Run**.
6. O bucket `briefing-files` precisa existir. Se ele já existe, o SQL configura o bucket para os arquivos enviados pelo briefing.

## 2. Como testar

1. Abra `index.html` pelo GitHub Pages ou pelo servidor onde você publica o RafahStudio.
2. Entre no RafahStudio.
3. Vá em **Pedidos**.
4. Clique em **Copiar link do briefing**.
5. Envie o link para o celular.
6. No celular, preencha o briefing e envie fotos.
7. Volte ao RafahStudio no computador.
8. Em até 30 segundos, o novo briefing deve aparecer em **Pedidos**.

## 3. Importante

- O projeto usa a **Publishable Key** no frontend. Isso é esperado para aplicações web; nunca coloque `sb_secret_...` ou `service_role` no código.
- O link de briefing contém um token aleatório do workspace. Não publique esse token separadamente.
- Nesta etapa, os pedidos/clientes/orçamentos existentes continuam sendo armazenados localmente no navegador. O briefing é a primeira parte conectada à nuvem.
- O bucket de briefing fica público para que o designer consiga visualizar/baixar as fotos sem transformar o projeto HTML puro em uma aplicação com backend próprio. Em uma etapa posterior podemos trocar isso por Storage privado + autenticação Supabase.
- O limite inicial do formulário é 8 MB por arquivo.

## 4. Se aparecer erro

Se o briefing mostrar `new row violates row-level security policy`, o `supabase_setup.sql` não foi executado por completo.

Se aparecer erro de Storage, confirme em **Storage > Buckets** que existe um bucket chamado exatamente:

`briefing-files`

Se o site abrir mas o briefing não enviar, confira o console do navegador (F12 > Console) e veja a mensagem retornada pelo Supabase.
