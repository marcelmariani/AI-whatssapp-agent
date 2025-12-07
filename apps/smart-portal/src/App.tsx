import { useEffect, useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";

type Prompt = {
  _id: string;
  customerId: string;
  whatsappNumber: string;
  prompt: string;
  status: "active" | "inactive";
  createdAt?: string;
  updatedAt?: string;
  originPromptId?: string;
};
type Session = { _id: string; phone: string; status: string; customerId: string; qrCode?: string | null };
type Balance = { tokensRemaining: number } | null;

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000";
const apiKey = import.meta.env.VITE_API_KEY || "dev-key";

type Section = "dashboard" | "prompt" | "whatsapp" | "billing" | "profile";

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem("customer_token"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("dashboard");

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [newPromptText, setNewPromptText] = useState("");
  const [newWhatsapp, setNewWhatsapp] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editPromptText, setEditPromptText] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [phone, setPhone] = useState("");
  const [balance, setBalance] = useState<Balance>(null);
  const [msg, setMsg] = useState("");
  const [bootError, setBootError] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [creatingSessionId, setCreatingSessionId] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [isLaunchingCheckout, setIsLaunchingCheckout] = useState(false);
  const [isFinalizingCheckout, setIsFinalizingCheckout] = useState(false);
  const [profileData, setProfileData] = useState({
    name: "",
    document: "",
    phone: "",
    type: "PF",
    address: { street: "", number: "", city: "", state: "", zip: "", country: "" }
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  async function doLogin(loginEmail: string, loginPassword: string) {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ email: loginEmail, password: loginPassword })
    });
    if (!res.ok) {
      throw new Error("Credenciais inválidas");
    }
    const data = await res.json();
    if (data.role !== "customer") throw new Error("Acesso restrito a clientes");
    localStorage.setItem("customer_token", data.token);
    setToken(data.token);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      await doLogin(email, password);
    } catch (err: any) {
      setLoginError(err?.message || "Erro ao conectar");
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ name, email, password, role: "customer" })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Erro ao registrar");
      }
      // Alguns backends retornam token; se não, faz login após registrar.
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("customer_token", data.token);
        setToken(data.token);
      } else {
        await doLogin(email, password);
      }
      setIsRegister(false);
    } catch (err: any) {
      setLoginError(err?.message || "Erro ao registrar");
    }
  }

  async function handleGoogleLogin(credentialResponse: any) {
    setLoginError("");
    try {
      const res = await fetch(`${apiBase}/api/auth/google-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ credential: credentialResponse.credential })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData?.message || "Erro ao autenticar com Google");
      }
      const data = await res.json();
      localStorage.setItem("customer_token", data.token);
      setToken(data.token);
    } catch (err: any) {
      setLoginError(err?.message || "Erro ao autenticar com Google");
    }
  }

  const googleLogin = useGoogleLogin({
    onSuccess: handleGoogleLogin,
    onError: () => setLoginError("Falha ao autenticar com Google")
  });

  function handleLogout() {
    localStorage.removeItem("customer_token");
    setToken(null);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMsg("As senhas não conferem.");
      return;
    }
    try {
      const res = await apiFetch(`${apiBase}/api/customer/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (!res.ok) {
        const errData = await safeJson<{ message: string }>(res);
        throw new Error(errData?.message || "Falha ao trocar senha");
      }
      setMsg("Senha alterada com sucesso.");
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setMsg(err?.message || "Erro ao alterar senha");
    }
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

  async function safeJson<T>(res: Response): Promise<T | null> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function loadPrompts() {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts`);
      const data = await safeJson<Prompt[]>(res);
      setPrompts(data || []);
    } catch (err: any) {
      setPrompts([]);
      setBootError(err?.message || "Falha ao carregar prompts");
    }
  }

  async function loadSessions() {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/sessions`);
      const data = await safeJson<Session[]>(res);
      if (data) setSessions(data);
    } catch (err: any) {
      setSessions([]);
      setBootError(err?.message || "Falha ao carregar sessões");
    }
  }

  async function loadCustomer() {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/me`);
      const data = await safeJson<any>(res);
      if (data) {
        setPaymentMethodId(data.paymentMethodId || null);
        setProfileData({
          name: data.name || "",
          document: data.document || "",
          phone: data.phone || "",
          type: data.type || "PF",
          address: data.address || { street: "", number: "", city: "", state: "", zip: "", country: "" }
        });
      }
    } catch (err: any) {
      setPaymentMethodId(null);
    }
  }

  async function loadBalance() {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/balance`);
      if (res.ok) {
        const data = await safeJson<Balance>(res);
        if (data) setBalance(data);
      } else {
        setBalance(null);
      }
    } catch (err: any) {
      setBalance(null);
      setBootError(err?.message || "Falha ao carregar tokens");
    }
  }

  async function startStripeCheckout() {
    setMsg("");
    if (!profileData.document || !profileData.phone) {
      setMsg("Perfil incompleto. Complete nome, documento e telefone em Perfil antes de adicionar cartão.");
      setActiveSection("profile");
      return;
    }
    setIsLaunchingCheckout(true);
    try {
      const origin = window.location.origin;
      const successUrl = `${origin}?billing=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}?billing=cancel`;
      const res = await apiFetch(`${apiBase}/api/customer/billing/checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ successUrl, cancelUrl })
      });
      const data = await safeJson<{ url?: string }>(res);
      if (!res.ok || !data?.url) {
        const errData = await safeJson<{ message: string }>(res);
        throw new Error(errData?.message || "Falha ao iniciar checkout");
      }
      window.location.href = data.url;
    } catch (err: any) {
      setMsg(err?.message || "Erro ao iniciar checkout");
    } finally {
      setIsLaunchingCheckout(false);
    }
  }

  async function finalizeStripeCheckout(sessionId: string) {
    setIsFinalizingCheckout(true);
    try {
      const res = await apiFetch(`${apiBase}/api/customer/payment-method/checkout-complete?session_id=${encodeURIComponent(sessionId)}`);
      const data = await safeJson<{ paymentMethodId?: string; message?: string }>(res);
      if (!res.ok || !data?.paymentMethodId) {
        throw new Error(data?.message || "Falha ao finalizar checkout");
      }
      setPaymentMethodId(data.paymentMethodId);
      setMsg("Cartão atualizado e ativo via Stripe.");
      loadSessions();
    } catch (err: any) {
      setMsg(err?.message || "Erro ao finalizar checkout");
    } finally {
      setIsFinalizingCheckout(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      const res = await apiFetch(`${apiBase}/api/customer/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData)
      });
      if (!res.ok) {
        const errData = await safeJson<{ message: string }>(res);
        throw new Error(errData?.message || "Falha ao salvar perfil");
      }
      setMsg("Perfil atualizado com sucesso.");
    } catch (err: any) {
      setMsg(err?.message || "Erro ao salvar perfil");
    } finally {
      setIsSavingProfile(false);
    }
  }

  // PROMPTS
  async function createPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!newWhatsapp) {
      setMsg("Informe um número de WhatsApp com sessão ativa.");
      return;
    }
    const hasActive = sessions.some(s => s.phone === newWhatsapp && s.status === "connected");
    if (!hasActive) {
      setMsg("Número não possui sessão ativa. Crie uma em WhatsApp primeiro.");
      setActiveSection("whatsapp");
      return;
    }
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappNumber: newWhatsapp, prompt: newPromptText })
      });
      if (!res.ok) throw new Error("Falha ao criar prompt");
      setMsg("Prompt criado como inativo. Ative quando estiver pronto.");
      setNewPromptText("");
      setNewWhatsapp("");
      loadPrompts();
    } catch (err: any) {
      setMsg(err?.message || "Erro ao criar prompt");
    }
  }

  async function copyPrompt(id: string) {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts/${id}/copy`, { method: "POST" });
      if (res.ok) {
        const data = await safeJson<Prompt>(res);
        if (data) {
          setEditingPromptId(data._id);
          setEditPromptText(data.prompt);
          setEditWhatsapp(data.whatsappNumber);
        }
        setMsg("Cópia criada (inativa) para edição.");
        loadPrompts();
      } else {
        setMsg("Não foi possível copiar o prompt.");
      }
    } catch (err: any) {
      setMsg(err?.message || "Erro ao copiar prompt");
    }
  }

  async function updatePrompt(id: string) {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: editPromptText, whatsappNumber: editWhatsapp })
      });
      if (!res.ok) throw new Error("Falha ao salvar alterações");
      setMsg("Prompt atualizado (permanece inativo).");
      setEditingPromptId(null);
      setEditPromptText("");
      setEditWhatsapp("");
      loadPrompts();
    } catch (err: any) {
      setMsg(err?.message || "Erro ao atualizar prompt");
    }
  }

  async function activatePrompt(id: string) {
    const target = prompts.find(p => p._id === id);
    if (!target) return;
    const alreadyActive = prompts.some(p => p.whatsappNumber === target.whatsappNumber && p.status === "active" && p._id !== id);
    const confirmText = alreadyActive
      ? "Há um prompt ativo para este número. Ativar este irá inativar o anterior. Confirmar?"
      : "Ativar este prompt para o número informado?";
    if (!confirm(confirmText)) return;
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts/${id}/activate`, { method: "PATCH" });
      if (!res.ok) throw new Error("Falha ao ativar prompt");
      setMsg("Prompt ativado. O anterior (se existia) foi inativado.");
      loadPrompts();
    } catch (err: any) {
      setMsg(err?.message || "Erro ao ativar prompt");
    }
  }

  async function deactivatePrompt(id: string) {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts/${id}/deactivate`, { method: "PATCH" });
      if (!res.ok) throw new Error("Falha ao inativar prompt");
      setMsg("Prompt inativado.");
      loadPrompts();
    } catch (err: any) {
      setMsg(err?.message || "Erro ao inativar prompt");
    }
  }

  async function deletePrompt(id: string) {
    if (!confirm("Excluir prompt inativo?")) return;
    try {
      const res = await apiFetch(`${apiBase}/api/customer/prompts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMsg("Prompt excluído.");
        loadPrompts();
      } else {
        const errorData = await safeJson<{ message: string }>(res);
        setMsg(`Erro: ${errorData?.message || "Falha ao excluir"}`);
      }
    } catch (err: any) {
      setMsg(err?.message || "Erro ao excluir prompt");
    }
  }

  useEffect(() => {
    if (token) {
      (async () => {
        try {
          await Promise.all([loadCustomer(), loadPrompts(), loadSessions(), loadBalance()]);
        } catch (err: any) {
          setBootError("Sessão expirada ou servidor indisponível");
          handleLogout();
        }
      })();
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const url = new URL(window.location.href);
    const billingStatus = url.searchParams.get("billing");
    const sessionId = url.searchParams.get("session_id");
    if (billingStatus === "success" && sessionId) {
      finalizeStripeCheckout(sessionId);
    } else if (billingStatus === "cancel") {
      setMsg("Checkout cancelado.");
    }
    if (billingStatus) {
      url.searchParams.delete("billing");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", url.pathname + (url.search ? `?${url.searchParams.toString()}` : ""));
    }
  }, [token]);

  // Polling para atualizar sessões enquanto o modal QR está visível
  useEffect(() => {
    if (showQrModal && creatingSessionId) {
      const interval = setInterval(() => {
        loadSessions();
      }, 1500); // 1.5s para atualização rápida do QR
      setPollInterval(interval);
      return () => {
        clearInterval(interval);
      };
    } else if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [showQrModal, creatingSessionId]);

  async function deleteSession(sessionId: string) {
    if (!confirm("Tem certeza que deseja deletar esta sessão?")) return;
    try {
      const res = await apiFetch(`${apiBase}/api/customer/sessions/${sessionId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setMsg("Sessão deletada com sucesso.");
        loadSessions();
      } else {
        const errorData = await safeJson<{ message: string }>(res);
        setMsg(`Erro: ${errorData?.message || "Falha ao deletar sessão"}`);
      }
    } catch (err: any) {
      setMsg(`Erro ao deletar sessão: ${err?.message}`);
    }
  }

  async function deactivateSession(sessionId: string) {
    if (!confirm("Tem certeza que deseja inativar esta sessão? A IA deixará de responder a este número.")) return;
    try {
      const res = await apiFetch(`${apiBase}/api/customer/sessions/${sessionId}/deactivate`, {
        method: "PATCH"
      });
      if (res.ok) {
        setMsg("Sessão desativada. A IA deixou de responder a este número.");
        loadSessions();
      } else {
        const errorData = await safeJson<{ message: string }>(res);
        setMsg(`Erro: ${errorData?.message || "Falha ao desativar sessão"}`);
      }
    } catch (err: any) {
      setMsg(`Erro ao desativar sessão: ${err?.message}`);
    }
  }

  async function reactivateSession(sessionId: string) {
    try {
      const res = await apiFetch(`${apiBase}/api/customer/sessions/${sessionId}/reactivate`, {
        method: "PATCH"
      });
      if (res.ok) {
        setCreatingSessionId(sessionId);
        setShowQrModal(true);
        setMsg("Gerando novo QR Code para reativar a IA...");
        loadSessions();
      } else {
        const errorData = await safeJson<{ message: string }>(res);
        setMsg(`Erro: ${errorData?.message || "Falha ao reativar sessão"}`);
      }
    } catch (err: any) {
      setMsg(`Erro ao reativar sessão: ${err?.message}`);
    }
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return;
    if (!profileData.document || !profileData.phone) {
      setMsg("Perfil incompleto. Complete dados em Perfil antes de criar sessões.");
      setActiveSection("profile");
      return;
    }
    if (!paymentMethodId) {
      setMsg("Adicione um cartão ativo em Billing antes de criar sessões.");
      setActiveSection("billing");
      return;
    }
    try {
      const res = await apiFetch(`${apiBase}/api/customer/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const newSession = await safeJson<Session>(res);
      if (newSession) {
        setCreatingSessionId(newSession._id);
        setShowQrModal(true);
        // Ativar polling imediatamente para carregar QR
        if (!pollInterval) {
          const interval = setInterval(() => {
            loadSessions();
          }, 2000);
          setPollInterval(interval);
        }
        setMsg("Sessão criada. Escaneie o QR exibido abaixo.");
        loadSessions();
      }
    } catch (err: any) {
      setMsg(`Erro ao criar sessão: ${err?.message}`);
    }
    setPhone("");
  }

  function closeQrModal() {
    setShowQrModal(false);
    setCreatingSessionId(null);
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }

  const sessionCount = sessions.length;
  const tokens = balance?.tokensRemaining ?? "-";
  const activePromptCount = prompts.filter(p => p.status === "active").length;

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>SmartPortal</h1>
          <p>Acesse ou crie sua conta para configurar o atendimento automático e tokens.</p>
          <form onSubmit={isRegister ? handleRegister : handleLogin}>
            {isRegister && <label>Nome<input value={name} onChange={e => setName(e.target.value)} required /></label>}
            <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
            <label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
            {loginError && <div className="error-text">{loginError}</div>}
            {bootError && <div className="error-text">{bootError}</div>}
            <button type="submit">{isRegister ? "Criar conta" : "Entrar"}</button>
          </form>
          <div style={{ textAlign: "center", margin: "1rem 0" }}>
            <p className="muted">Ou</p>
          </div>
          <button 
            type="button" 
            onClick={() => googleLogin()}
            style={{ width: "100%", padding: "0.75rem", marginBottom: "1rem", backgroundColor: "#fff", color: "#000", border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer", fontWeight: "500" }}
          >
            🔐 Entrar com Google
          </button>
          <button className="ghost" onClick={() => { setIsRegister(!isRegister); setLoginError(""); }}> {isRegister ? "Já tenho conta" : "Criar nova conta"} </button>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">SmartIA</div>
        <nav>
          <span>Cliente</span>
          <a className={activeSection === "dashboard" ? "active" : ""} onClick={() => setActiveSection("dashboard")}>Dashboard</a>
          <a className={activeSection === "whatsapp" ? "active" : ""} onClick={() => setActiveSection("whatsapp")}>WhatsApp</a>
          <a className={activeSection === "prompt" ? "active" : ""} onClick={() => setActiveSection("prompt")}>Prompt</a>
          <a className={activeSection === "profile" ? "active" : ""} onClick={() => setActiveSection("profile")}>Perfil</a>
          <a className={activeSection === "billing" ? "active" : ""} onClick={() => setActiveSection("billing")}>Billing</a>
        </nav>
        <button className="ghost" onClick={handleLogout}>Sair</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="subtitle">Painel do Cliente</p>
            <h1>Bem-vindo</h1>
          </div>
          <div className="top-actions">
            <button className="pill">Suporte</button>
            <div className="avatar-wrapper" onClick={() => setShowUserMenu(v => !v)}>
              <div className="avatar">C</div>
              {showUserMenu && (
                <div className="user-menu" onClick={e => e.stopPropagation()}>
                  <div className="user-menu-item" onClick={() => { setShowPasswordModal(true); setShowUserMenu(false); }}>Alterar senha</div>
                  <div className="user-menu-item" onClick={() => { setShowUserMenu(false); handleLogout(); }}>Sair</div>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="hero-card">
          <div>
            <p className="eyebrow">Resumo</p>
            <h2>Automatize seu atendimento</h2>
            <p className="muted">Use o menu para gerenciar prompt, sessões de WhatsApp e créditos.</p>
            {msg && <div className="toast">{msg}</div>}
          </div>
          <div className="stats">
            <div>
              <p className="label">Tokens</p>
              <h3>{tokens}</h3>
            </div>
            <div>
              <p className="label">Sessões</p>
              <h3>{sessionCount}</h3>
            </div>
            <div>
              <p className="label">Prompt</p>
              <h3>{activePromptCount > 0 ? "Ativo" : "Pendente"}</h3>
            </div>
          </div>
        </section>

        {activeSection === "dashboard" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header"><div><p className="eyebrow">Fluxo</p><h3>1. Perfil</h3></div></div>
              <p className={profileData.document && profileData.phone ? "success" : "muted"}>
                {profileData.document && profileData.phone ? "✓ Completo" : "⊘ Complete seus dados"}
              </p>
            </div>
            <div className="panel">
              <div className="panel-header"><div><p className="eyebrow">Fluxo</p><h3>2. Cartão</h3></div></div>
              <p className={paymentMethodId ? "success" : "muted"}>
                {paymentMethodId ? "✓ Ativo" : "⊘ Adicione cartão"}
              </p>
            </div>
            <div className="panel">
              <div className="panel-header"><div><p className="eyebrow">Fluxo</p><h3>3. WhatsApp</h3></div></div>
              <p className={sessions.some(s => s.status === "connected") ? "success" : "muted"}>
                {sessions.some(s => s.status === "connected") ? "✓ Sessão ativa" : "⊘ Crie uma sessão"}
              </p>
            </div>
            <div className="panel">
              <div className="panel-header"><div><p className="eyebrow">Fluxo</p><h3>4. Prompt</h3></div></div>
              <p className={activePromptCount > 0 ? "success" : "muted"}>
                {activePromptCount > 0 ? "✓ Ativo" : "⊘ Ative um prompt"}
              </p>
            </div>
          </section>
        )}

        {activeSection === "prompt" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Novo prompt</p>
                  <h3>Crie e deixe inativo até ativar</h3>
                  <p className="muted">Informe um número com sessão de WhatsApp ativa. Novos prompts nascem inativos.</p>
                </div>
              </div>
              <form className="stack" onSubmit={createPrompt}>
                <label>Número de WhatsApp ativo
                  <input
                    list="connected-numbers"
                    value={newWhatsapp}
                    onChange={e => setNewWhatsapp(e.target.value)}
                    placeholder="Ex.: 5511999999999"
                    required
                  />
                  <datalist id="connected-numbers">
                    {sessions.filter(s => s.status === "connected").map(s => (
                      <option key={s._id} value={s.phone}>{s.phone}</option>
                    ))}
                  </datalist>
                </label>
                <label>Prompt
                  <textarea value={newPromptText} onChange={e => setNewPromptText(e.target.value)} rows={5} required />
                </label>
                <small className="muted">Regra: apenas números com sessão ativa; novos prompts ficam inativos até você ativar.</small>
                <button type="submit">Adicionar (inativo)</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Prompts cadastrados</p>
                  <h3>Gerencie ativações</h3>
                  <p className="muted">Alterar ou excluir somente inativos. Para alterar um ativo, crie uma cópia, edite e ative (isso inativará o anterior).</p>
                </div>
              </div>
              {prompts.length === 0 ? (
                <p>Nenhum prompt cadastrado ainda.</p>
              ) : (
                <div className="stack">
                  {prompts.map(p => (
                    <div key={p._id} className="session-card">
                      <div className="session-header">
                        <div>
                          <p className="eyebrow">Número</p>
                          <h3>{p.whatsappNumber}</h3>
                        </div>
                        <span className={`badge ${p.status === "active" ? "success" : "muted"}`}>
                          {p.status === "active" ? "Ativo" : "Inativo"}
                        </span>
                      </div>

                      {editingPromptId === p._id ? (
                        <div className="stack">
                          <label>Número
                            <input value={editWhatsapp} onChange={e => setEditWhatsapp(e.target.value)} />
                          </label>
                          <label>Prompt
                            <textarea value={editPromptText} onChange={e => setEditPromptText(e.target.value)} rows={4} />
                          </label>
                          <div className="session-actions">
                            <button className="btn btn-reactivate" onClick={() => updatePrompt(p._id)}>Salvar alterações</button>
                            <button className="btn btn-deactivate" type="button" onClick={() => { setEditingPromptId(null); setEditPromptText(""); setEditWhatsapp(""); }}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <p className="muted">{p.prompt}</p>
                      )}

                      <div className="session-actions">
                        <button className="btn btn-reactivate" onClick={() => copyPrompt(p._id)}>Copiar</button>
                        {p.status === "inactive" && (
                          <>
                            <button className="btn" onClick={() => { setEditingPromptId(p._id); setEditPromptText(p.prompt); setEditWhatsapp(p.whatsappNumber); }}>Editar</button>
                            <button className="btn btn-deactivate" onClick={() => activatePrompt(p._id)}>Ativar</button>
                            <button className="btn btn-delete" onClick={() => deletePrompt(p._id)}>Excluir</button>
                          </>
                        )}
                        {p.status === "active" && (
                          <button className="btn btn-deactivate" onClick={() => deactivatePrompt(p._id)}>Inativar</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
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
              <form className="stack" onSubmit={createSession}>
                <label>Telefone (WhatsApp)<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="55DDDnumero" /></label>
                <button type="submit">Criar sessão</button>
              </form>
              <ul className="list compact">
                {sessions.map(s => (
                  <li key={s._id}>
                    <div>
                      <div>
                        <strong>{s.phone}</strong>
                        <br />
                        <span className={`session-status ${s.status}`}>
                          {s.status === "connected" ? "✓ Ativo (respondendo 24/7)" : s.status === "pending" ? "⏳ Aguardando..." : s.status === "inactive" ? "⊘ Inativo" : "✗ Erro"}
                        </span>
                      </div>
                      <div className="session-actions">
                        {s.status === "pending" && (
                          <button className="btn-small btn-delete" onClick={() => deleteSession(s._id)}>Deletar</button>
                        )}
                        {s.status === "connected" && (
                          <button className="btn-small btn-deactivate" onClick={() => deactivateSession(s._id)}>Desativar</button>
                        )}
                        {s.status === "inactive" && (
                          <>
                            <button className="btn-small btn-reactivate" onClick={() => reactivateSession(s._id)}>Reativar</button>
                            <button className="btn-small btn-delete" onClick={() => deleteSession(s._id)}>Deletar</button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* QR Code Modal */}
        {showQrModal && (
          <div className="modal-overlay" onClick={closeQrModal}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Escaneie com WhatsApp</h2>
                <button className="close-btn" onClick={closeQrModal}>✕</button>
              </div>
              <div className="modal-body">
                {creatingSessionId && (
                  (() => {
                    const session = sessions.find(s => s._id === creatingSessionId);
                    if (!session) return <p className="loading-text">Carregando sessão...</p>;
                    return (
                      <>
                        {session.qrCode ? (
                          <>
                            <img 
                              src={session.qrCode} 
                              alt="QR Code"
                            />
                            <p className="qr-hint">Abra WhatsApp e aponte a câmera para escanear</p>
                          </>
                        ) : (
                          <>
                            <div className="loading">⟳</div>
                            <p className="loading-text">Gerando QR Code... (aguarde até 30 segundos)</p>
                          </>
                        )}
                        {session.status === "connected" && (
                          <div className="qr-status">
                            <p className="success">✓ Conectado com sucesso!</p>
                            <p className="subtitle">A sessão está pronta para usar.</p>
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
              <div className="modal-footer">
                <button onClick={closeQrModal}>{sessions.find(s => s._id === creatingSessionId)?.status === "connected" ? "Fechar" : "Cancelar"}</button>
              </div>
            </div>
          </div>
        )}

        {showPasswordModal && (
          <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Alterar senha</h2>
                <button className="close-btn" onClick={() => setShowPasswordModal(false)}>✕</button>
              </div>
              <div className="modal-body">
                <form className="stack" onSubmit={changePassword}>
                  <label>Senha atual<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /></label>
                  <label>Nova senha<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} /></label>
                  <label>Confirmar nova senha<input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} /></label>
                  <button type="submit">Salvar</button>
                </form>
              </div>
            </div>
          </div>
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
              <div className="metric-big">Saldo: {tokens} tokens</div>
              <p className="muted">Créditos não são editáveis pelo cliente. Fale com o suporte para recarga.</p>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Pagamento</p>
                  <h3>Cartão ativo</h3>
                  <p className="muted">É obrigatório ter um cartão ativo para manter sessões de WhatsApp.</p>
                </div>
              </div>
              <div className="stack">
                <div className={`badge ${paymentMethodId ? "success" : "muted"}`}>
                  {paymentMethodId ? "Cartão ativo" : "Sem cartão ativo"}
                </div>
                <p className="muted">
                  {paymentMethodId
                    ? "Cartão armazenado com segurança via Stripe."
                    : "Nenhum cartão ativo. Clique para adicionar com Stripe Checkout."}
                </p>
                {paymentMethodId && <p className="muted">Pagamento ativo (token Stripe): {paymentMethodId}</p>}
                <button onClick={startStripeCheckout} disabled={isLaunchingCheckout || isFinalizingCheckout}>
                  {isLaunchingCheckout ? "Redirecionando para Stripe..." : "Adicionar/atualizar cartão via Stripe"}
                </button>
                {isFinalizingCheckout && <small className="muted">Finalizando checkout...</small>}
              </div>
            </div>
          </section>
        )}

        {activeSection === "profile" && (
          <section className="panels-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Perfil</p>
                  <h3>Dados cadastrais</h3>
                  <p className="muted">Complete suas informações para usar todos os recursos.</p>
                </div>
              </div>
              <form className="stack" onSubmit={saveProfile}>
                <label>Nome completo
                  <input value={profileData.name} onChange={e => setProfileData({ ...profileData, name: e.target.value })} required />
                </label>
                <label>Documento (CPF/CNPJ)
                  <input value={profileData.document} onChange={e => setProfileData({ ...profileData, document: e.target.value })} required />
                </label>
                <label>Telefone
                  <input value={profileData.phone} onChange={e => setProfileData({ ...profileData, phone: e.target.value })} required />
                </label>
                <label>Tipo
                  <select value={profileData.type} onChange={e => setProfileData({ ...profileData, type: e.target.value as "PF" | "PJ" })}>
                    <option value="PF">Pessoa Física</option>
                    <option value="PJ">Pessoa Jurídica</option>
                  </select>
                </label>
                <fieldset className="stack">
                  <legend>Endereço (opcional)</legend>
                  <label>Rua
                    <input value={profileData.address.street} onChange={e => setProfileData({ ...profileData, address: { ...profileData.address, street: e.target.value } })} />
                  </label>
                  <label>Número
                    <input value={profileData.address.number} onChange={e => setProfileData({ ...profileData, address: { ...profileData.address, number: e.target.value } })} />
                  </label>
                  <label>Cidade
                    <input value={profileData.address.city} onChange={e => setProfileData({ ...profileData, address: { ...profileData.address, city: e.target.value } })} />
                  </label>
                  <label>Estado
                    <input value={profileData.address.state} onChange={e => setProfileData({ ...profileData, address: { ...profileData.address, state: e.target.value } })} />
                  </label>
                  <label>CEP
                    <input value={profileData.address.zip} onChange={e => setProfileData({ ...profileData, address: { ...profileData.address, zip: e.target.value } })} />
                  </label>
                  <label>País
                    <input value={profileData.address.country} onChange={e => setProfileData({ ...profileData, address: { ...profileData.address, country: e.target.value } })} />
                  </label>
                </fieldset>
                <button type="submit" disabled={isSavingProfile}>{isSavingProfile ? "Salvando..." : "Salvar perfil"}</button>
              </form>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
