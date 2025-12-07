import { useEffect, useMemo, useState } from "react";

type Customer = {
  _id: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  type: "PF" | "PJ";
};

type Prompt = {
  customerId: string;
  prompt: string;
};

type Session = {
  _id: string;
  customerId: string;
  phone: string;
  status: string;
  qrCode?: string;
};

type Balance = {
  customerId: string;
  tokensRemaining: number;
};

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000";
const apiKey = import.meta.env.VITE_API_KEY || "dev-key";

type Section = "dashboard" | "customers" | "whatsapp" | "billing" | "prompts";

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem("admin_token"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("dashboard");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<Partial<Customer>>({ type: "PF" });
  const [selectedId, setSelectedId] = useState<string>("");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptText, setPromptText] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionPhone, setSessionPhone] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [tokensToAdd, setTokensToAdd] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const selectedCustomer = useMemo(() => customers.find(c => c._id === selectedId) || null, [customers, selectedId]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        setLoginError("Credenciais inválidas");
        return;
      }
      const data = await res.json();
      if (data.role !== "admin") {
        setLoginError("Acesso restrito a administradores");
        return;
      }
      localStorage.setItem("admin_token", data.token);
      setToken(data.token);
    } catch {
      setLoginError("Erro ao conectar");
    }
  }

  function handleLogout() {
    localStorage.removeItem("admin_token");
    setToken(null);
  }

  async function apiFetch(url: string, options?: RequestInit) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        "x-api-key": apiKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (res.status === 401) {
      handleLogout();
      throw new Error("unauthorized");
    }
    return res;
  }

  async function fetchCustomers() {
    const res = await apiFetch(`${apiBase}/api/admin/customers`);
    setCustomers(await res.json());
  }

  async function fetchPrompt(customerId: string) {
    const res = await apiFetch(`${apiBase}/api/admin/prompts/${customerId}`);
    if (res.ok) {
      const data = await res.json();
      setPrompt(data);
      setPromptText(data.prompt);
    } else {
      setPrompt(null);
      setPromptText("");
    }
  }

  async function fetchSessions() {
    const res = await apiFetch(`${apiBase}/api/admin/whatsapp/sessions`);
    setSessions(await res.json());
  }

  async function fetchBalance(customerId: string) {
    const res = await apiFetch(`${apiBase}/api/admin/balances/${customerId}`);
    if (res.ok) setBalance(await res.json());
    else setBalance(null);
  }

  useEffect(() => {
    if (token) {
      fetchCustomers();
      fetchSessions();
    }
  }, [token]);

  useEffect(() => {
    if (selectedId && token) {
      fetchPrompt(selectedId);
      fetchBalance(selectedId);
    }
  }, [selectedId, token]);

  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const method = selectedId ? "PUT" : "POST";
    const url = selectedId ? `${apiBase}/api/admin/customers/${selectedId}` : `${apiBase}/api/admin/customers`;
    await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    setForm({ type: "PF" });
    setSelectedId("");
    await fetchCustomers();
    setLoading(false);
    setMessage("Cliente salvo.");
  }

  async function editCustomer(c: Customer) {
    setSelectedId(c._id);
    setForm(c);
  }

  async function deleteCustomer(id: string) {
    await apiFetch(`${apiBase}/api/admin/customers/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setSelectedId("");
      setPrompt(null);
      setBalance(null);
    }
    await fetchCustomers();
  }

  async function savePromptText(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    await apiFetch(`${apiBase}/api/admin/prompts/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: selectedId, prompt: promptText, whatsappNumber: sessionPhone || "" })
    });
    setMessage("Prompt salvo.");
    fetchPrompt(selectedId);
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !sessionPhone) return;
    await apiFetch(`${apiBase}/api/admin/whatsapp/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: selectedId, phone: sessionPhone })
    });
    setSessionPhone("");
    setMessage("Sessão criada (QR placeholder).");
    fetchSessions();
  }

  async function addTokens(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    await apiFetch(`${apiBase}/api/admin/charges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: selectedId, tokens: tokensToAdd })
    });
    setMessage("Tokens creditados.");
    fetchBalance(selectedId);
  }

  const totalCustomers = customers.length;
  const totalSessions = sessions.length;
  const totalTokens = balance?.tokensRemaining ?? 0;

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>SmartPortal Admin</h1>
          <p>Acesse com sua conta admin para gerenciar clientes.</p>
          <form onSubmit={handleLogin}>
            <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
            <label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
            {loginError && <div className="error-text">{loginError}</div>}
            <button type="submit">Entrar</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">SmartIA</div>
        <nav>
          <span>Visão geral</span>
          <a className={activeSection === "dashboard" ? "active" : ""} onClick={() => setActiveSection("dashboard")}>Dashboard</a>
          <a className={activeSection === "customers" ? "active" : ""} onClick={() => setActiveSection("customers")}>Clientes</a>
          <a className={activeSection === "whatsapp" ? "active" : ""} onClick={() => setActiveSection("whatsapp")}>WhatsApp</a>
          <a className={activeSection === "billing" ? "active" : ""} onClick={() => setActiveSection("billing")}>Billing</a>
          <a className={activeSection === "prompts" ? "active" : ""} onClick={() => setActiveSection("prompts")}>Prompts</a>
        </nav>
        <button className="ghost" onClick={handleLogout}>Sair</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="subtitle">Painel Admin</p>
            <h1>Bem-vindo de volta</h1>
          </div>
          <div className="top-actions">
            <button className="pill">Notificações</button>
            <div className="avatar">A</div>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="eyebrow">Destaque</p>
            <h2>Resultados da semana</h2>
            <p className="muted">Gerencie clientes, sessões de WhatsApp e créditos de tokens.</p>
            {message && <div className="toast">{message}</div>}
          </div>
          <div className="stats">
            <div>
              <p className="label">Clientes</p>
              <h3>{totalCustomers}</h3>
            </div>
            <div>
              <p className="label">Sessões</p>
              <h3>{totalSessions}</h3>
            </div>
            <div>
              <p className="label">Tokens (cliente selecionado)</p>
              <h3>{balance ? balance.tokensRemaining : "-"}</h3>
            </div>
          </div>
        </section>

        {activeSection === "dashboard" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Clientes</p>
                  <h3>Resumo</h3>
                </div>
              </div>
              <p>Total: {totalCustomers}</p>
              <p>Selecionado: {selectedCustomer ? selectedCustomer.name : "Nenhum"}</p>
            </div>
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">WhatsApp</p>
                  <h3>Sessões</h3>
                </div>
              </div>
              <p>Ativas: {sessions.length}</p>
            </div>
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Billing</p>
                  <h3>Tokens</h3>
                </div>
              </div>
              <p>Saldo cliente selecionado: {balance ? balance.tokensRemaining : "-"}</p>
            </div>
          </section>
        )}

        {activeSection === "customers" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Clientes</p>
                  <h3>{selectedId ? "Editar cliente" : "Novo cliente"}</h3>
                </div>
              </div>
              <form className="form-grid" onSubmit={saveCustomer}>
                <label>Nome<input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
                <label>Documento<input value={form.document || ""} onChange={e => setForm({ ...form, document: e.target.value })} required /></label>
                <label>Email<input type="email" value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} required /></label>
                <label>Telefone<input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} required /></label>
                <label>Tipo
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as Customer["type"] })}>
                    <option value="PF">PF</option>
                    <option value="PJ">PJ</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" disabled={loading}>{loading ? "Salvando..." : "Salvar"}</button>
                  {selectedId && <button type="button" className="ghost" onClick={() => { setSelectedId(""); setForm({ type: "PF" }); }}>Limpar</button>}
                </div>
              </form>
            </div>

            <div className="panel list-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Lista</p>
                  <h3>Clientes</h3>
                </div>
              </div>
              <ul className="list">
                {customers.map(c => (
                  <li key={c._id} className={selectedId === c._id ? "selected" : ""}>
                    <div>
                      <strong>{c.name}</strong> ({c.type})<br />{c.email} · {c.phone}
                    </div>
                    <div className="actions">
                      <button onClick={() => editCustomer(c)}>Editar</button>
                      <button className="secondary" onClick={() => setSelectedId(c._id)}>Selecionar</button>
                      <button className="danger" onClick={() => deleteCustomer(c._id)}>Excluir</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {activeSection === "prompts" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Prompt da IA</p>
                  <h3>{selectedCustomer ? selectedCustomer.name : "Selecione um cliente"}</h3>
                </div>
              </div>
              {selectedCustomer ? (
                <form className="stack" onSubmit={savePromptText}>
                  <label>Prompt<textarea value={promptText} onChange={e => setPromptText(e.target.value)} rows={5} /></label>
                  <button type="submit">Salvar prompt</button>
                </form>
              ) : (
                <p>Selecione um cliente em "Clientes" para editar o prompt.</p>
              )}
            </div>
          </section>
        )}

        {activeSection === "whatsapp" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">WhatsApp</p>
                  <h3>Sessões</h3>
                </div>
              </div>
              {selectedCustomer ? (
                <>
                  <form className="stack" onSubmit={createSession}>
                    <label>Telefone (WhatsApp)<input value={sessionPhone} onChange={e => setSessionPhone(e.target.value)} placeholder="55DDDnumero" /></label>
                    <button type="submit">Criar sessão</button>
                  </form>
                  <ul className="list compact">
                    {sessions.map(s => (
                      <li key={s._id}>
                        {s.phone} · {s.status} {s.customerId === selectedId ? "(selecionado)" : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Selecione um cliente em "Clientes" para gerenciar sessões.</p>
              )}
            </div>
          </section>
        )}

        {activeSection === "billing" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Billing</p>
                  <h3>Tokens</h3>
                </div>
              </div>
              <div className="metric-big">Saldo: {balance ? balance.tokensRemaining : "-"} tokens</div>
              {selectedCustomer ? (
                <form className="stack" onSubmit={addTokens}>
                  <label>Creditar tokens<input type="number" value={tokensToAdd} onChange={e => setTokensToAdd(Number(e.target.value))} /></label>
                  <button type="submit">Creditar</button>
                </form>
              ) : (
                <p>Selecione um cliente em "Clientes" para creditar tokens.</p>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
