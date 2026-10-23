/**
 * Connecting, in one dialog. Reading needs no wallet, so this only appears when a
 * member chooses to vote or act as an officer. Three ways in: a wallet app, a
 * wallet kept in this browser (create, unlock or restore), or a development
 * account on the local network.
 */
import { useEffect, useRef, useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import { decodeError } from "../lib/errors.js";
import { shorten } from "../lib/format.js";
import { backupFileName, looksLikeKeystore, passphraseProblem } from "../lib/localWallet.js";
import { nameOf } from "../lib/directory.js";
import { addToWallet } from "../lib/networks.js";
import { useChain } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import { useWallet } from "../state/wallet.jsx";
import CopyButton from "./CopyButton.jsx";
import Field from "./Field.jsx";
import Icon from "./Icon.jsx";
import { Notice } from "./States.jsx";

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function WalletDialog({ open, onClose }) {
  const { t } = useLocale();
  const { network } = useNetwork();
  const wallet = useWallet();
  const { me } = useChain();
  const ref = useRef(null);
  const [view, setView] = useState("choose"); // choose | create | unlock | restore | backup | node
  const [created, setCreated] = useState(null);
  const [networkNote, setNetworkNote] = useState(null);

  // open and close the native dialog from the `open` prop
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setView(wallet.hasLocal && !wallet.account ? "unlock" : "choose");
      setNetworkNote(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const problem = wallet.error ? decodeError(wallet.error) : null;
  const connected = Boolean(wallet.account);

  async function addNetwork() {
    try {
      await addToWallet(wallet.appProvider ?? wallet.apps[0]?.provider ?? window.ethereum, network);
      setNetworkNote({ tone: "success", text: t("wallet.networkAdded", { network: network.label }) });
    } catch (error) {
      setNetworkNote({ tone: "error", text: t(decodeError(error).key) });
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="wallet-title"
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
    >
      <div className="dialog__body">
        <div className="dialog__head">
          <h2 id="wallet-title">{t("wallet.title")}</h2>
          <button type="button" className="btn btn--quiet btn--small" onClick={onClose}>
            <Icon name="close" />
            {t("wallet.close")}
          </button>
        </div>

        {connected && view === "choose" && (
          <div className="stack">
            <p>
              {t("wallet.connectedAs")} <strong className="num wrap">{wallet.account}</strong>
            </p>
            <p className="muted">
              {wallet.kind === "app" && t("wallet.via.app", { name: wallet.appName })}
              {wallet.kind === "local" && t("wallet.via.local")}
              {wallet.kind === "node" && t("wallet.via.node")}
            </p>
            <ul className="facts">
              <li>{me.roles.member ? t("wallet.role.member") : t("wallet.role.notMember")}</li>
              {(me.roles.registrar || me.roles.proposer || me.roles.admin) && <li>{t("wallet.role.officer")}</li>}
            </ul>
            <div className="row">
              <CopyButton value={wallet.account} label={t("wallet.copyAddress")} />
              {wallet.kind === "app" && (
                <button type="button" className="btn btn--quiet btn--small" onClick={addNetwork}>
                  {t("wallet.addNetwork", { network: network.label })}
                </button>
              )}
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  wallet.disconnect();
                  onClose();
                }}
              >
                {t("wallet.disconnect")}
              </button>
            </div>
            {networkNote && <Notice tone={networkNote.tone}>{networkNote.text}</Notice>}
          </div>
        )}

        {!connected && view === "choose" && (
          <div className="stack">
            <p>{t("wallet.intro")}</p>

            <section className="option" aria-labelledby="opt-app">
              <h3 id="opt-app">{t("wallet.app.title")}</h3>
              <p className="muted">{t("wallet.app.body")}</p>
              {wallet.apps.length === 0 ? (
                <Notice tone="info">{t("wallet.app.none")}</Notice>
              ) : (
                <div className="row">
                  {wallet.apps.map((entry) => (
                    <button key={entry.info.uuid} type="button" className="btn" disabled={wallet.busy} onClick={() => wallet.connectApp(entry)}>
                      {entry.info.icon && <img src={entry.info.icon} alt="" width="20" height="20" />}
                      {t("wallet.app.connect", { name: entry.info.name })}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="option" aria-labelledby="opt-local">
              <h3 id="opt-local">{t("wallet.local.title")}</h3>
              <p className="muted">{t("wallet.local.body")}</p>
              <div className="row">
                {wallet.hasLocal ? (
                  <button type="button" className="btn" onClick={() => setView("unlock")}>
                    {t("wallet.local.unlockAction", { address: shorten(wallet.localAddress) })}
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => setView("create")}>
                    {t("wallet.local.create")}
                  </button>
                )}
                <button type="button" className="btn btn--quiet" onClick={() => setView("restore")}>
                  {t("wallet.local.restore")}
                </button>
              </div>
            </section>

            {wallet.canUseNode && <NodeAccounts onDone={onClose} />}

            {problem && (
              <Notice tone="error" role="alert">
                {t(problem.key, problem.params)}
              </Notice>
            )}
          </div>
        )}

        {view === "create" && <CreateWallet onBack={() => setView("choose")} onCreated={(result) => (setCreated(result), setView("backup"))} />}
        {view === "backup" && created && <Backup created={created} onDone={onClose} />}
        {view === "unlock" && <Unlock onBack={() => setView("choose")} onDone={onClose} />}
        {view === "restore" && <Restore onBack={() => setView("choose")} onDone={onClose} />}
      </div>
    </dialog>
  );
}

function CreateWallet({ onBack, onCreated }) {
  const { t } = useLocale();
  const wallet = useWallet();
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [touched, setTouched] = useState(false);

  const weak = passphraseProblem(pass);
  const mismatch = pass !== again;

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (weak || mismatch) return;
    const result = await wallet.createLocal(pass);
    if (result) onCreated(result);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h3>{t("wallet.local.create")}</h3>
      <p className="muted">{t("wallet.local.createBody")}</p>
      <Field id="pass" label={t("wallet.local.passphrase")} help={t("wallet.local.passphraseHelp")} error={touched && weak ? t(weak) : null} required requiredWord={t("form.required")}>
        {(props) => <input {...props} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} onBlur={() => pass && setTouched(true)} />}
      </Field>
      <Field id="again" label={t("wallet.local.confirm")} error={touched && !weak && mismatch ? t("wallet.local.mismatch") : null} required requiredWord={t("form.required")}>
        {(props) => <input {...props} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
      </Field>
      <div className="row">
        <button type="submit" className="btn btn--primary" aria-busy={wallet.busy} disabled={wallet.busy}>
          {wallet.busy ? t("wallet.local.creating") : t("wallet.local.create")}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onBack}>
          {t("form.back")}
        </button>
      </div>
    </form>
  );
}

function Backup({ created, onDone }) {
  const { t } = useLocale();
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack">
      <h3>{t("wallet.local.created")}</h3>
      <Notice tone="info">{t("wallet.local.backupWarning")}</Notice>
      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            download(backupFileName(created.address), created.json);
            setSaved(true);
          }}
        >
          {t("wallet.local.download")}
        </button>
        {saved && <span className="muted">{t("wallet.local.downloaded")}</span>}
      </div>
      <div>
        <p className="muted">{t("wallet.local.addressHelp")}</p>
        <p className="num wrap">{created.address}</p>
        <CopyButton value={created.address} label={t("wallet.copyAddress")} />
      </div>
      <button type="button" className="btn" onClick={onDone}>
        {t("form.done")}
      </button>
    </div>
  );
}

function Unlock({ onBack, onDone }) {
  const { t } = useLocale();
  const wallet = useWallet();
  const [pass, setPass] = useState("");
  const [wrong, setWrong] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const ok = await wallet.unlockLocal(pass);
    if (ok) onDone();
    else setWrong(true);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h3>{t("wallet.local.unlockTitle")}</h3>
      <p className="num wrap muted">{wallet.localAddress}</p>
      <Field id="unlock-pass" label={t("wallet.local.passphrase")} error={wrong ? t("wallet.local.wrong") : null} required requiredWord={t("form.required")}>
        {(props) => <input {...props} type="password" autoComplete="current-password" value={pass} onChange={(e) => (setPass(e.target.value), setWrong(false))} />}
      </Field>
      <div className="row">
        <button type="submit" className="btn btn--primary" aria-busy={wallet.busy} disabled={wallet.busy || !pass}>
          {t("wallet.local.unlock")}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onBack}>
          {t("form.back")}
        </button>
      </div>
      <div>
        {!confirmForget ? (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setConfirmForget(true)}>
            {t("wallet.local.forget")}
          </button>
        ) : (
          <div className="stack">
            <p>{t("wallet.local.forgetWarning")}</p>
            <div className="row">
              <button type="button" className="btn btn--small" onClick={() => (wallet.forgetLocal(), onBack())}>
                {t("wallet.local.forgetYes")}
              </button>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setConfirmForget(false)}>
                {t("form.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

function Restore({ onBack, onDone }) {
  const { t } = useLocale();
  const wallet = useWallet();
  const [json, setJson] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [pass, setPass] = useState("");
  const [wrong, setWrong] = useState(false);

  async function pick(event) {
    const file = event.target.files?.[0];
    setJson(null);
    setFileError(null);
    if (!file) return;
    const text = await file.text();
    if (looksLikeKeystore(text)) setJson(text);
    else setFileError(t("wallet.local.badFile"));
  }

  async function submit(event) {
    event.preventDefault();
    if (!json) return;
    const ok = await wallet.unlockLocal(pass, json);
    if (ok) onDone();
    else setWrong(true);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h3>{t("wallet.local.restore")}</h3>
      <Field id="backup-file" label={t("wallet.local.file")} error={fileError} help={t("wallet.local.fileHelp")}>
        {(props) => <input {...props} type="file" accept="application/json,.json" onChange={pick} />}
      </Field>
      <Field id="restore-pass" label={t("wallet.local.passphrase")} error={wrong ? t("wallet.local.wrong") : null} required requiredWord={t("form.required")}>
        {(props) => <input {...props} type="password" autoComplete="current-password" value={pass} onChange={(e) => (setPass(e.target.value), setWrong(false))} />}
      </Field>
      <div className="row">
        <button type="submit" className="btn btn--primary" aria-busy={wallet.busy} disabled={wallet.busy || !json || !pass}>
          {t("wallet.local.restoreAction")}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onBack}>
          {t("form.back")}
        </button>
      </div>
    </form>
  );
}

function NodeAccounts({ onDone }) {
  const { t } = useLocale();
  const wallet = useWallet();
  const [accounts, setAccounts] = useState(null);
  const [choice, setChoice] = useState("");

  useEffect(() => {
    let live = true;
    wallet
      .nodeAccounts()
      .then((list) => live && (setAccounts(list), setChoice(list[1] || list[0] || "")))
      .catch(() => live && setAccounts([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (accounts === null || accounts.length === 0) return null;
  return (
    <section className="option" aria-labelledby="opt-node">
      <h3 id="opt-node">{t("wallet.node.title")}</h3>
      <p className="muted">{t("wallet.node.body")}</p>
      <div className="row">
        <div className="field field--inline">
          <label htmlFor="node-account">{t("wallet.node.account")}</label>
          <select id="node-account" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {nameOf(a) || shorten(a)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn"
          disabled={wallet.busy}
          onClick={async () => {
            if (await wallet.connectNode(choice)) onDone();
          }}
        >
          {t("wallet.node.use")}
        </button>
      </div>
    </section>
  );
}
