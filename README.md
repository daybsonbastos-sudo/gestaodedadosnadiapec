# Sistema de Gestão de Confinamento - Controle de Baias

Sistema web para gestão zootécnica e operacional de confinamento de bovinos, controle de baias/currais, importação de relatórios (PDF e Excel no padrão Nutron / Feed Manager), conciliação com o Relatório de Rebanho e dashboard analítico com exportação de relatórios.

---

## 🚀 Como Iniciar o Sistema

Na pasta do projeto (`C:\Users\daybs\.gemini\antigravity\scratch\gestao-confinamento`):

```bash
# Iniciar o servidor backend e frontend integrado
npm start
```

Ou diretamente:
```bash
node server.js
```

Em seguida, abra o navegador em:
👉 **`http://localhost:3000`**

---

## 🔑 Funcionalidades Implementadas

### 1. Autenticação & Regra do Primeiro Administrador
- **Auto-promoção do primeiro usuário**: No primeiro acesso ao sistema, o primeiro usuário cadastrado é automaticamente promovido a **Administrador (`admin`)**.
- O Administrador possui privilégios para:
  - Gerir usuários (criar, editar, excluir e promover/rebaixar outros operadores a administradores).
  - Gerir Unidades de Confinamento (cadastrar fazendas, capacidade e códigos).
  - Importar relatórios e atualizar o rebanho.

### 2. Tela Inicial (Layout Idêntico à Referência)
- **Tema Dark Moderno** com verde esmeralda (`#10b981` / `#22c55e`).
- **Data da Posição**: Identificador no topo da posição atual registrada.
- **Banner de Boas-Vindas**: *"Olá, {NOME}. O rebanho está aqui. X animais em Y currais. Z prontos para embarque."*
- **4 Cards de KPIs**:
  1. **Animais Ativos** (total de cabeças no confinamento)
  2. **Currais Ocupados** (número de baias ativas)
  3. **Prontos p/ Embarque** (lotes com peso atingido ou tempo de cocho)
  4. **Última Atualização** (data e hora da última sincronização)
- **3 Cards Grandes de Acesso Rápido**:
  - **Relatório de Rebanho**: Posição completa por baia.
  - **Importar Relatório**: Upload de arquivos Excel e PDF de lotes ativos.
  - **Dashboard**: Filtros temporais e evolução de movimentações.

### 3. Módulo de Importação de Relatórios (Excel e PDF)
- Suporta arquivos:
  - **Excel (`.xlsx` / `.xls`)**: Padrão Nutron / Feed Manager de "Controle de Lotes Ativos".
  - **PDF (`.pdf`)**: Padrão de relatório de lotes ativos.
- **Pré-visualização inteligente**: Antes de aplicar no banco de dados, o sistema apresenta uma tabela comparativa com o que mudou (lotes novos, alteração de quantidade de cabeças, pesos e dietas).
- Botão para confirmar a sincronização com um clique.

### 4. Módulo Relatório de Rebanho (Padrão "Relatório _reb_")
- Exibição de todas as baias e piquetes (Baia 01 a 38, Enfermaria, Piquetes 01 a 04, Rotacionados 01 a 03).
- Colunas completas: Baia, Lote, Raça, Categoria, Nº Animais, Data de Entrada, Peso Entrada, Dieta, Dias Confinados, GPD, Peso Abate Previsto, Peso Estimado Hoje, Previsão de Embarque, Lotação em m² e Observações.
- Botão **Exportar PDF** formatado para impressão/relatório.
- Botão **Exportar Excel (XLSX)** para download imediato.

### 5. Dashboard Analítico de Movimentações
- **Filtros por período** (Data Início e Fim).
- **Filtros por Tipo de Movimento** (Entradas de Compra, Entradas por Transferência, Venda para Abate, Abate Cantina, Mortes, Saídas por Transferência).
- **Filtro por Baia/Curral**.
- Gráficos interativos em tempo real via **Chart.js** (Distribuição de tipos e Evolução mensal de entradas x saídas).
- Botão **Exportar Relatório em PDF** dos dados filtrados.
- Botão **Exportar Relatório em Excel (XLSX)** dos dados filtrados.

### 6. Módulo de Administração
- Gestão completa de Usuários (com botão para **Promover a Admin** ou rebaixar para Operador).
- Gestão de Unidades de Confinamento (Confinamento Carigi, etc.).

---

## 📂 Dados Semeados da Base Real
A base de dados já foi inicializada em `data/db.json` com os dados reais dos arquivos enviados:
- **6.607 animais ativos** distribuídos em **41 currais**.
- **517 movimentações históricas** extraídas da planilha de movimentações diárias (compras, transferências, abates e mortalidade).
