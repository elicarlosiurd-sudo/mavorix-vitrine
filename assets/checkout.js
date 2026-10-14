/* Checkout da MAVORIX, em três passos: dados do cliente, entrega e pagamento.
   O CPF, o CEP e o telefone são conferidos aqui e de novo no servidor, porque
   o DSers recusa o pedido se qualquer um vier errado. */
(function () {
  const $ = s => document.querySelector(s);
  const loja = () => window.loja;
  const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const so = (s, n) => (s || '').replace(/\D/g, '').slice(0, n);

  /* ---------- conferências ---------- */
  const cpfValido = v => {
    const c = so(v, 11);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (const [ate, pos] of [[9, 10], [10, 11]]) {
      let s = 0;
      for (let i = 0; i < ate; i++) s += +c[i] * (pos - i);
      let d = (s * 10) % 11; if (d === 10) d = 0;
      if (d !== +c[ate]) return false;
    }
    return true;
  };
  const emailValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v || '').trim());
  const foneValido = v => { const n = so(v, 11); return n.length === 10 || n.length === 11; };
  const cepValido = v => so(v, 8).length === 8;

  const mascaras = {
    cpf: v => so(v, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'),
    fone: v => { const n = so(v, 11); return n.length > 10 ? n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3'); },
    cep: v => so(v, 8).replace(/(\d{5})(\d{1,3})/, '$1-$2')
  };

  /* ---------- estado ---------- */
  const VAZIO = { nome: '', email: '', fone: '', cpf: '', cep: '', rua: '', numero: '', compl: '', bairro: '', cidade: '', uf: '' };
  /* O cupom guardado aqui é só o que a cliente digitou e o que o servidor
     respondeu que ele vale. Na hora de fechar, só o CÓDIGO é enviado: quem
     calcula o desconto de verdade é o servidor, com os preços dele. */
  let cupom = null, cupomErro = '', guardouRascunho = false;
  let dados = { ...VAZIO }, passo = 1, pagamento = 'pix', enviando = false, pedidoFeito = null;
  /* A tela de pagamento pode não abrir por rede ruim ou script bloqueado. Não
     existe caminho alternativo: existe tentar de novo, na mesma tela. */
  let falhouAoAbrir = false;
  /* pedido já gravado, esperando pagamento na própria página */
  let aberto = null;       // { numero, chave, total, totalPix, preferencia }
  let brickPronto = false; // o formulário do Mercado Pago já foi montado?
  let aguardando = null;   // Pix ou boleto gerado: { pix, boleto, mensagem }
  let recusa = null;       // última mensagem de recusa, para a cliente ler
  const CHAVE_MP = 'APP_USR-0fdcdba2-680f-416a-a323-4e7f28396326'; // pública, por isso vive aqui
  try { dados = { ...VAZIO, ...JSON.parse(localStorage.getItem('mavorix-cliente') || '{}') }; } catch (_) {}
  const guardar = () => { try { localStorage.setItem('mavorix-cliente', JSON.stringify(dados)); } catch (_) {} };

  const FRETE = 19.9;
  const frete = sub => sub >= window.loja.FRETE_GRATIS ? 0 : FRETE;
  const total = () => { const s = loja().totais(); const f = frete(s); const t = s + f; return { sub: s, frete: f, total: t, pix: t * (1 - loja().DESC_PIX) }; };

  /* ---------- telas ---------- */
  const campo = (id, rot, extra = '', largo = false) => `
    <label class="cf${largo ? ' cf-largo' : ''}" for="cf-${id}"><span>${rot}</span>
      <input id="cf-${id}" name="${id}" ${extra} value="${(dados[id] || '').replace(/"/g, '&quot;')}" autocomplete="${AUTO[id] || 'on'}">
      <em class="erro" id="er-${id}"></em>
    </label>`;
  const AUTO = { nome: 'name', email: 'email', fone: 'tel', cpf: 'off', cep: 'postal-code', rua: 'address-line1', numero: 'address-line2', bairro: 'address-level3', cidade: 'address-level2', uf: 'address-level1' };

  function telaDados() {
    return `
      <span class="mono">Passo 1 de 3</span>
      <h2 class="display">Seus dados</h2>
      <p class="ck-sub">Usamos só para emitir o envio e falar com você sobre o pedido. O CPF é exigido para emitir a nota e, nos itens importados, para liberar o pacote na alfândega.</p>
      <div class="grid2">
        ${campo('nome', 'Nome completo', 'inputmode="text"', true)}
        ${campo('email', 'E-mail', 'type="email" inputmode="email"', true)}
        ${campo('fone', 'Celular com DDD', 'type="tel" inputmode="tel" placeholder="(11) 90000-0000"')}
        ${campo('cpf', 'CPF', 'inputmode="numeric" placeholder="000.000.000-00"')}
      </div>
      <button class="btn btn-ink btn-full" data-ir="2">Continuar para a entrega</button>
      <p class="ck-nota">Seus dados ficam guardados só para processar este pedido.</p>`;
  }
  function telaEntrega() {
    return `
      <span class="mono">Passo 2 de 3</span>
      <h2 class="display">Entrega</h2>
      <p class="ck-sub">Digite o CEP que o resto preenche sozinho.</p>
      <div class="grid2">
        ${campo('cep', 'CEP', 'inputmode="numeric" placeholder="00000-000"')}
        ${campo('numero', 'Número', 'inputmode="numeric"')}
        ${campo('rua', 'Rua', '', true)}
        ${campo('compl', 'Complemento (opcional)')}
        ${campo('bairro', 'Bairro')}
        ${campo('cidade', 'Cidade')}
        ${campo('uf', 'Estado', 'maxlength="2" placeholder="SP"')}
      </div>
      <div class="ck-linhas">
        <div><span>Frete</span><span>${brl(total().frete)}</span></div>
        <div><span>Prazo</span><span>${loja().prazo()}</span></div>
      </div>
      <div class="ck-botoes">
        <button class="btn btn-line" data-ir="1">Voltar</button>
        <button class="btn btn-ink" data-ir="3">Revisar o pedido</button>
      </div>`;
  }
  /* A sacola ficou vazia dentro da revisão: a pessoa tirou tudo. Em vez de
     deixar um checkout sem pedido, com um botão que não leva a nada, a tela
     diz o que houve e devolve a pessoa à loja. */
  function telaSemItens() {
    return `
      <span class="mono">Sacola vazia</span>
      <h2 class="display">Não sobrou nada no pedido</h2>
      <p class="ck-nota" style="margin:14px 0 22px">Você tirou todas as peças. Nada foi cobrado. Volte à loja para escolher de novo.</p>
      <button class="btn btn-ink btn-full" data-fechar>Voltar à loja</button>`;
  }
  function telaPagamento() {
    const t = total();
    /* CADA PEÇA COM O SEU CONTADOR E O SEU "TIRAR" (§MVX-15). Aqui é o
       último lugar em que a pessoa olha o pedido inteiro, e é justamente
       onde ela percebe o que não quer. Mandar voltar à gaveta para corrigir
       é onde se perde a venda. O índice é o da lista da loja, que é a mesma
       dos dois lados. */
    const itens = loja().itens().map((i, n) => `
      <div class="ck-item">
        <span class="ck-item-nome">${i.nome}${i.nota ? ` <small>${i.nota}</small>` : ''}</span>
        <span class="contador contador-ck">
          <button type="button" data-ckq="${n}" data-d="-1" aria-label="Menos uma unidade de ${i.nome}">−</button>
          <b>${i.q}</b>
          <button type="button" data-ckq="${n}" data-d="1" aria-label="Mais uma unidade de ${i.nome}">+</button>
        </span>
        <span class="ck-item-val">${brl(i.preco * i.q)}</span>
        <button type="button" class="ck-tirar-item" data-cktirar="${n}" aria-label="Tirar ${i.nome} do pedido">Tirar</button>
      </div>`).join('');
    return `
      <span class="mono">Passo 3 de 3</span>
      <h2 class="display">Revisão</h2>
      <div class="ck-linhas ck-itens">${itens}
        <div><span>Frete</span><span>${brl(t.frete)}</span></div>
        ${cupom ? `<div class="ck-desconto"><span>Cupom ${cupom.codigo} (${cupom.rotulo})</span><span>− ${brl(cupom.desconto)}</span></div>` : ''}
      </div>
      <div class="ck-cupom">
        ${cupom
          ? `<p class="ck-cupom-ok"><b>${cupom.codigo}</b> aplicado — você economiza ${brl(cupom.desconto)}.
             <button type="button" id="ck-tirar-cupom">Tirar</button></p>`
          : `<label class="sr" for="ck-cupom">Cupom de desconto</label>
             <input id="ck-cupom" placeholder="Tem um cupom?" autocomplete="off" maxlength="20" spellcheck="false">
             <button type="button" id="ck-usar-cupom">Aplicar</button>`}
        ${cupomErro ? `<span class="ck-cupom-erro">${cupomErro}</span>` : ''}
      </div>
      <div class="ck-entrega">
        <b>${dados.nome}</b><br>${dados.rua}, ${dados.numero}${dados.compl ? ', ' + dados.compl : ''}<br>
        ${dados.bairro} · ${dados.cidade} ${dados.uf.toUpperCase()} · ${mascaras.cep(dados.cep)}<br>
        CPF ${mascaras.cpf(dados.cpf)} · ${mascaras.fone(dados.fone)}
        <button class="ck-editar" data-ir="2">Editar</button>
      </div>
      <div class="final-tot"><span>Total</span><strong>${brl(Math.max(0, t.total - (cupom ? cupom.desconto : 0)))}</strong></div>
      <p class="ck-nota">Pix aprova na hora. No cartão, parcelamos em até 6x — o valor de cada parcela aparece no formulário.</p>
      <div class="ck-botoes">
        <button class="btn btn-line" data-ir="2">Voltar</button>
        <button class="btn btn-ink" id="ck-fechar-pedido">${enviando ? 'Abrindo...' : 'Ir para o pagamento'}</button>
      </div>
      <div class="notice on" id="ck-aviso">Você paga aqui mesmo, sem sair da loja. Na fatura do cartão aparece <b>MAVORIX</b>.</div>`;
  }

  /* ——— o cupom ———
     Conferido no servidor antes de fechar, para a cliente ver o desconto
     em vez de descobrir no total. O valor mostrado aqui é o mesmo que o
     servidor vai aplicar, porque quem calcula os dois é a mesma função. */
  async function aplicarCupom() {
    const campo = document.getElementById('ck-cupom');
    const codigo = (campo && campo.value || '').trim();
    if (!codigo) return;
    const botao = document.getElementById('ck-usar-cupom');
    if (botao) { botao.disabled = true; botao.textContent = 'Conferindo...'; }
    cupomErro = '';
    try {
      const r = await fetch('/api/cupom', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codigo, sub: total().sub }) });
      const j = await r.json();
      if (j.ok) cupom = { codigo: j.codigo, rotulo: j.rotulo, desconto: j.desconto };
      else { cupom = null; cupomErro = j.erro || 'cupom inválido'; }
    } catch (_) { cupom = null; cupomErro = 'não deu para conferir agora'; }
    pinta();
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#ck-usar-cupom')) return aplicarCupom();
    if (e.target.closest('#ck-tirar-cupom')) { cupom = null; cupomErro = ''; pinta(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'ck-cupom') { e.preventDefault(); aplicarCupom(); }
  });

  /* ——— tela 4: o pagamento, dentro da loja ——— */
  function telaBrick() {
    const t = total();
    if (aguardando && aguardando.pix) {
      return `
        <span class="mono">Pedido ${aberto.numero}</span>
        <h2 class="display">Falta pagar o Pix</h2>
        <p class="ck-sub">Abra o app do seu banco, escolha Pix e leia o código. Assim que cair, a gente confirma o pedido e avisa por e-mail.</p>
        ${aguardando.pix.qr ? `<img class="pix-qr" src="data:image/png;base64,${aguardando.pix.qr}" alt="QR Code do Pix" width="240" height="240">` : ''}
        <button class="btn btn-ink btn-full" id="ck-copiar-pix">Copiar código Pix</button>
        <p class="ck-codigo">${aguardando.pix.copia}</p>
        <p class="ck-nota">Total no Pix: <b>${brl(aberto.totalPix)}</b> · o código vale por 30 minutos.</p>
        <button class="btn btn-line btn-full" data-fechar>Fechar</button>`;
    }
    if (aguardando && aguardando.boleto) {
      return `
        <span class="mono">Pedido ${aberto.numero}</span>
        <h2 class="display">Seu boleto está pronto</h2>
        <p class="ck-sub">O pagamento leva até 2 dias úteis para ser confirmado. O boleto também chega no seu e-mail.</p>
        <a class="btn btn-ink btn-full" href="${aguardando.boleto}" target="_blank" rel="noopener">Abrir boleto</a>
        <button class="btn btn-line btn-full" data-fechar>Fechar</button>`;
    }
    return `
      <span class="mono">Pedido ${aberto.numero}</span>
      <h2 class="display">Pagamento</h2>
      <p class="ck-sub">Cartão em até 6x, Pix ou boleto — sem sair da loja.</p>
      <div class="ck-selos" role="note" aria-label="Segurança desta compra">
        <div>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V4.8a3 3 0 0 1 6 0V7"/><rect x="3.2" y="7" width="9.6" height="6.3" rx="1.4"/></svg>
          <div><b>Conexão protegida do começo ao fim</b><span>O cadeado e o endereço mavorix.com.br ficam na barra do navegador durante todo o pagamento.</span></div>
        </div>
        <div>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6 13.2 3.4v3.9c0 3-2.1 5.6-5.2 7.1-3.1-1.5-5.2-4.1-5.2-7.1V3.4z"/><path d="M5.9 8.1 7.4 9.6l2.9-3"/></svg>
          <div><b>O número do cartão não passa pela loja</b><span>Os campos são do Mercado Pago. A MAVORIX não vê, não recebe e não guarda o número do seu cartão.</span></div>
        </div>
        <div>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 8a5.2 5.2 0 1 0 1.7-3.9"/><path d="M2.6 2.9v2.6h2.6"/></svg>
          <div><b>7 dias para devolver, garantidos por lei</b><span>Artigo 49 do Código de Defesa do Consumidor. Reembolso integral, sem precisar justificar.</span></div>
        </div>
      </div>
      <p class="ck-empresa">Paris Mavorix · CNPJ 14.431.262/0001-15</p>
      ${recusa ? `<div class="notice on">${recusa}</div>` : ''}
      ${falhouAoAbrir ? `<button class="btn btn-ink btn-full" data-tentar>Tentar de novo</button>` : ''}
      <div id="mp-brick"></div>`;
  }

  /* monta o formulário do Mercado Pago (cartão em iframe: o número do cartão
     nunca passa pelo nosso servidor) */
  async function montarBrick() {
    if (brickPronto || !aberto || aguardando) return;
    brickPronto = true;
    try {
      if (!window.MercadoPago) await new Promise((ok, falha) => {
        const sc = document.createElement('script');
        sc.src = 'https://sdk.mercadopago.com/js/v2';
        sc.onload = ok; sc.onerror = falha;
        document.head.appendChild(sc);
      });
      const mp = new window.MercadoPago(CHAVE_MP, { locale: 'pt-BR' });
      await mp.bricks().create('payment', 'mp-brick', {
        initialization: { amount: aberto.total, payer: { email: dados.email } },
        customization: {
          visual: { hideFormTitle: true, style: { theme: 'default', customVariables: { borderRadiusSmall: '0px', borderRadiusMedium: '0px', borderRadiusLarge: '0px' } } },
          paymentMethods: { creditCard: 'all', debitCard: 'all', bankTransfer: 'all', ticket: 'all', maxInstallments: 6 }
        },
        callbacks: {
          onReady: () => { falhouAoAbrir = false; },
          onSubmit: async ({ selectedPaymentMethod, formData }) => {
            recusa = null;
            const metodo = selectedPaymentMethod === 'bank_transfer' ? 'pix'
              : selectedPaymentMethod === 'ticket' ? 'boleto' : 'cartao';
            const r = await fetch('/api/pagamento', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                numero: aberto.numero, chave: aberto.chave, metodo,
                tokenCartao: formData && formData.token,
                parcelas: formData && formData.installments,
                paymentMethodId: formData && formData.payment_method_id,
                issuerId: formData && formData.issuer_id,
                deviceId: window.MP_DEVICE_SESSION_ID
              })
            });
            const j = await r.json();
            if (!j.ok) { recusa = j.mensagem || j.erro || 'Não foi possível concluir o pagamento.'; pinta(); throw new Error(recusa); }
            if (j.status === 'approved') { pedidoFeito = { numero: aberto.numero, total: j.total, aprovado: true, prazo: loja().prazo() }; loja().limpar(); pinta(); return; }
            aguardando = { pix: j.pix, boleto: j.boleto, mensagem: j.mensagem };
            loja().limpar();
            pinta();
          },
          onError: () => { recusa = 'Não foi possível abrir o pagamento. Recarregue a página.'; pinta(); }
        }
      });
    } catch (_) {
      recusa = 'A tela de pagamento não abriu. <b>Nada foi cobrado.</b> Toque em tentar de novo.';
      falhouAoAbrir = true;
      brickPronto = false;
      pinta();
    }
  }
  function telaPronto() {
    if (pedidoFeito.aprovado) {
      return `
        <span class="mono">Pedido ${pedidoFeito.numero}</span>
        <h2 class="display">Pagamento aprovado</h2>
        <p class="ck-sub">Obrigado! Já vamos preparar o seu pedido. Você recebe a confirmação e o rastreio em ${dados.email}.</p>
        <div class="ck-linhas"><div><span>Total pago</span><span>${brl(pedidoFeito.total)}</span></div><div><span>Entrega</span><span>${pedidoFeito.prazo}</span></div></div>
        <button class="btn btn-ink btn-full" data-fechar>Fechar</button>`;
    }
    return `
      <span class="mono">Pedido registrado</span>
      <h2 class="display">Pedido ${pedidoFeito.numero}</h2>
      <p class="ck-sub">Guardamos seus dados de entrega e os itens. Você recebe a confirmação em ${dados.email}.</p>
      <div class="ck-linhas"><div><span>Total</span><span>${brl(pedidoFeito.total)}</span></div><div><span>Entrega</span><span>${pedidoFeito.prazo}</span></div></div>
      <div class="notice on">Não conseguimos abrir a tela de pagamento agora. <b>Nenhum valor foi cobrado</b> e seu pedido está guardado. A gente procura você pelo e-mail para concluir.</div>
      <button class="btn btn-ink btn-full" data-fechar>Fechar</button>`;
  }

  function pinta() {
    const box = $('#ck-corpo');
    box.innerHTML = pedidoFeito ? telaPronto()
      : aberto ? telaBrick()
      : (passo === 3 && !loja().itens().length) ? telaSemItens()
      : passo === 1 ? telaDados() : passo === 2 ? telaEntrega() : telaPagamento();
    if (aberto && !pedidoFeito && !aguardando) montarBrick();
    box.querySelectorAll('input').forEach(i => {
      i.addEventListener('blur', e => {
        /* Sai do campo de e-mail com algo válido: guardamos a sacola para
           poder escrever se ela não voltar. Uma vez por visita basta. */
        if (e.target.name !== 'email' || !emailValido(e.target.value) || guardouRascunho) return;
        guardouRascunho = true;
        const l = loja().itens();
        if (!l.length) return;
        fetch('/api/rascunho', { method: 'POST', headers: { 'content-type': 'application/json' },
          /* Só o código da peça viaja. Nome e preço o servidor busca no
             catálogo dele — assim ninguém escolhe o que vai escrito no
             e-mail que a loja manda. */
          body: JSON.stringify({ email: e.target.value.trim(), nome: dados.nome,
            itens: l.map(i => ({ id: i.id, kit: i.kit, q: i.q })) }) }).catch(() => {});
      });
      i.addEventListener('input', e => {
        const n = e.target.name;
        /* Campo sem nome não é campo do cadastro — é o cupom, por exemplo.
           Sem esta saída, digitar nele procurava um aviso de erro que não
           existe e derrubava a tela inteira. */
        if (!n) return;
        if (n === 'cpf') e.target.value = mascaras.cpf(e.target.value);
        if (n === 'fone') e.target.value = mascaras.fone(e.target.value);
        if (n === 'cep') { e.target.value = mascaras.cep(e.target.value); if (so(e.target.value, 8).length === 8) buscaCep(so(e.target.value, 8)); }
        if (n === 'uf') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
        dados[n] = e.target.value; guardar();
        const er = $('#er-' + n); if (er) er.textContent = '';
      });
    });
  }

  async function buscaCep(cep) {
    const aviso = $('#er-cep'); if (aviso) aviso.textContent = 'procurando...';
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (j.erro) { if (aviso) aviso.textContent = 'CEP não encontrado'; return; }
      dados.rua = j.logradouro || dados.rua; dados.bairro = j.bairro || dados.bairro;
      dados.cidade = j.localidade || dados.cidade; dados.uf = j.uf || dados.uf;
      guardar();
      for (const k of ['rua', 'bairro', 'cidade', 'uf']) { const el = $('#cf-' + k); if (el) el.value = dados[k]; }
      if (aviso) aviso.textContent = '';
      const num = $('#cf-numero'); if (num && !num.value) num.focus();
    } catch (_) { if (aviso) aviso.textContent = 'não deu para buscar, preencha à mão'; }
  }

  function confere(campos) {
    const regras = {
      nome: v => (v || '').trim().split(' ').filter(Boolean).length >= 2 || 'digite nome e sobrenome',
      email: v => emailValido(v) || 'e-mail inválido',
      fone: v => foneValido(v) || 'telefone com DDD',
      cpf: v => cpfValido(v) || 'CPF inválido',
      cep: v => cepValido(v) || 'CEP com 8 números',
      rua: v => (v || '').trim().length > 2 || 'preencha a rua',
      numero: v => (v || '').trim().length > 0 || 'preencha o número',
      bairro: v => (v || '').trim().length > 1 || 'preencha o bairro',
      cidade: v => (v || '').trim().length > 1 || 'preencha a cidade',
      uf: v => /^[A-Za-z]{2}$/.test((v || '').trim()) || 'use a sigla, ex: SP'
    };
    let ok = true, primeiro = null;
    for (const c of campos) {
      const r = regras[c](dados[c]);
      const el = $('#er-' + c);
      if (r !== true) { ok = false; if (el) el.textContent = r; if (!primeiro) primeiro = c; }
      else if (el) el.textContent = '';
    }
    if (primeiro) { const el = $('#cf-' + primeiro); if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
    return ok;
  }

  async function enviar() {
    if (enviando) return;
    enviando = true; pinta();
    const t = total();
    const corpo = {
      cupom: cupom ? cupom.codigo : null,
      cliente: { nome: dados.nome.trim(), email: dados.email.trim(), fone: so(dados.fone, 11), cpf: so(dados.cpf, 11) },
      entrega: { cep: so(dados.cep, 8), rua: dados.rua.trim(), numero: dados.numero.trim(), compl: dados.compl.trim(), bairro: dados.bairro.trim(), cidade: dados.cidade.trim(), uf: dados.uf.toUpperCase() },
      itens: loja().itens().map(i => ({ id: i.id, kit: i.kit, cor: i.cor, tamanho: i.tamanho, q: i.q })),
      pagamento, frete: t.frete
    };
    try {
      const r = await fetch('/api/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.erro || 'falha ao registrar');
      try { localStorage.setItem('mavorix-pedido-aberto', j.numero); } catch (_) {}
      /* o pedido está gravado e o estoque comprometido: agora a cliente paga
         AQUI MESMO, na tela seguinte, sem sair da loja */
      aberto = { numero: j.numero, chave: j.chave, total: j.total, totalPix: j.totalPix, preferencia: j.pagamento };
      brickPronto = false;
    } catch (e) {
      enviando = false; pinta();
      const av = $('#ck-aviso');
      if (av) { av.classList.add('on'); av.innerHTML = 'Não deu para registrar o pedido agora. Tente de novo em instantes ou fale com a gente pelo e-mail <b>contato@mavorix.com.br</b>.'; }
      return;
    }
    enviando = false; pinta();
  }

  /* ---------- ligações ---------- */
  document.addEventListener('click', e => {
    const ir = e.target.closest('[data-ir]');
    if (ir) {
      const destino = +ir.dataset.ir;
      if (destino === 2 && passo === 1 && !confere(['nome', 'email', 'fone', 'cpf'])) return;
      if (destino === 3 && !confere(['cep', 'rua', 'numero', 'bairro', 'cidade', 'uf'])) return;
      passo = destino; pinta(); $('#cmodal .mbox').scrollTop = 0; return;
    }
    if (e.target.closest('[data-tentar]')) {
      falhouAoAbrir = false; recusa = null; brickPronto = false; pinta(); return;
    }
    const pg = e.target.closest('[data-pg]');
    if (pg) { pagamento = pg.dataset.pg; pinta(); return; }
    /* Editar e tirar na revisão. Quem manda na sacola é a loja; aqui só
       pedimos a mudança e repintamos com o que ela devolver. */
    const ckq = e.target.closest('[data-ckq]');
    if (ckq) { loja().mudar(+ckq.dataset.ckq, +ckq.dataset.d); return; }
    const cktirar = e.target.closest('[data-cktirar]');
    if (cktirar) { loja().tirar(+cktirar.dataset.cktirar); return; }
    if (e.target.closest('#ck-fechar-pedido')) return enviar();
    const copiar = e.target.closest('#ck-copiar-pix');
    if (copiar && aguardando && aguardando.pix) {
      navigator.clipboard.writeText(aguardando.pix.copia).then(() => {
        copiar.textContent = 'Código copiado ✓';
        setTimeout(() => { copiar.textContent = 'Copiar código Pix'; }, 2500);
      }).catch(() => {});
    }
  });

  /* A loja chama isto sempre que a sacola muda. Só repinta a revisão: nas
     telas de dados e de entrega, repintar apagaria o que está sendo
     digitado. */
  window.repintarCheckout = () => {
    if (passo !== 3 || pedidoFeito || aberto) return;
    if (!document.getElementById('cmodal').classList.contains('on')) return;
    const altura = $('#cmodal .mbox').scrollTop;
    pinta();
    $('#cmodal .mbox').scrollTop = altura;
  };

  window.abrirCheckout = () => {
    passo = 1; pedidoFeito = null; enviando = false;
    aberto = null; aguardando = null; recusa = null; brickPronto = false;
    pinta();
  };

  /* volta do Mercado Pago: /pagamento/sucesso, /pagamento/pendente ou /pagamento/erro */
  function telaRetorno(tipo, numero) {
    const titulos = { sucesso: 'Pagamento aprovado', pendente: 'Pagamento em análise', erro: 'Pagamento não concluído' };
    const textos = {
      sucesso: `Recebemos o seu pagamento. O pedido <b>${numero}</b> entra em separação e você recebe o código de rastreio por e-mail. A entrega leva de 7 a 15 dias úteis nas peças nacionais e de 16 a 30 dias nas importadas.`,
      pendente: `O pagamento do pedido <b>${numero}</b> ainda está sendo confirmado. Se foi Pix, costuma levar alguns minutos. Assim que cair, a gente envia o e-mail de confirmação.`,
      erro: `O pagamento do pedido <b>${numero}</b> não foi concluído. Nada foi cobrado. Você pode tentar de novo pela sacola ou falar com a gente em contato@mavorix.com.br.`
    };
    return `
      <span class="mono">Pedido ${numero}</span>
      <h2 class="display">${titulos[tipo]}</h2>
      <p class="ck-sub">${textos[tipo]}</p>
      <button class="btn btn-ink btn-full" data-fechar>Continuar comprando</button>`;
  }
  (function retorno() {
    const m = location.pathname.match(/^\/pagamento\/(sucesso|pendente|erro)/);
    if (!m) return;
    const q = new URLSearchParams(location.search);
    let numero = q.get('external_reference') || '';
    if (!numero) { try { numero = localStorage.getItem('mavorix-pedido-aberto') || 'em processamento'; } catch (_) { numero = 'em processamento'; } }
    if (m[1] !== 'erro') { try { localStorage.removeItem('mavorix-pedido-aberto'); } catch (_) {} }
    addEventListener('DOMContentLoaded', () => {
      if (m[1] === 'sucesso' && window.loja) window.loja.limpar();
      $('#ck-corpo').innerHTML = telaRetorno(m[1], numero);
      window.abrirRetorno && window.abrirRetorno();
      history.replaceState({}, '', '/');
    });
  })();
})();
