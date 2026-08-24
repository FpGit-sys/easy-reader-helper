const form = document.getElementById("server-form");
const input = document.getElementById("server-url");
const errorBox = document.getElementById("error");
const button = document.getElementById("connect");

const invoke = window.__TAURI__?.core?.invoke;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function loadSavedUrl() {
  if (!invoke) {
    showError("Esta tela deve ser aberta pelo aplicativo SiloNR Desktop.");
    button.disabled = true;
    return;
  }

  try {
    const saved = await invoke("get_saved_server_url");
    if (saved) input.value = saved;
  } catch {
    // A ausência de configuração é normal na primeira execução.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const serverUrl = input.value.trim();
  if (!serverUrl) {
    showError("Informe o endereço do servidor SiloNR.");
    return;
  }

  button.disabled = true;
  button.textContent = "Conectando…";

  try {
    await invoke("connect_to_server", { serverUrl });
  } catch (error) {
    showError(typeof error === "string" ? error : "Não foi possível conectar ao servidor.");
    button.disabled = false;
    button.textContent = "Conectar com segurança";
  }
});

loadSavedUrl();
