/**
 * The member's part of a ballot: choose, review, vote. A vote cannot be changed
 * once it is recorded, so it is a choice and then a deliberate button, never a tap
 * on an option that casts at once. When voting is not possible, the reason is said
 * in words: no wallet, not on the roster, not open yet, already over.
 */
import { useEffect, useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import { formatDateTime, shorten } from "../lib/format.js";
import { useChain } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import { useUi } from "../state/ui.jsx";
import { useWallet } from "../state/wallet.jsx";
import CopyButton from "./CopyButton.jsx";
import Icon from "./Icon.jsx";
import { Notice } from "./States.jsx";

function Receipt({ ballot, receipt }) {
  const { t } = useLocale();
  const { account } = useWallet();
  const { contracts } = useNetwork();
  const [hash, setHash] = useState(null);

  useEffect(() => {
    let live = true;
    if (account) contracts.voting.receiptHash(ballot.id, account).then((h) => live && setHash(h)).catch(() => {});
    return () => {
      live = false;
    };
  }, [account, ballot.id, contracts]);

  return (
    <div className="receipt" role="status">
      <h3>
        <Icon name="check" /> {t("receipt.title")}
      </h3>
      <p dir="auto">{t("receipt.body", { option: ballot.options[receipt.option], block: receipt.blockNumber })}</p>
      {hash && (
        <div>
          <p className="muted">{t("receipt.hashHelp")}</p>
          <p className="num wrap">{hash}</p>
          <CopyButton value={hash} label={t("receipt.copy")} />
        </div>
      )}
    </div>
  );
}

export default function VoteForm({ ballot, stage, sender }) {
  const { t, lang } = useLocale();
  const { account } = useWallet();
  const { me } = useChain();
  const { contracts } = useNetwork();
  const { openWallet } = useUi();
  const [choice, setChoice] = useState(null);
  const receipt = me.receipts[ballot.id];

  if (receipt) return <Receipt ballot={ballot} receipt={receipt} />;
  if (stage === "withdrawn") return null;

  if (stage === "pending") {
    return <Notice tone="info">{t("vote.notOpen.pending", { when: formatDateTime(ballot.opensAt, lang) })}</Notice>;
  }
  if (stage === "closed" || stage === "finalised") {
    return <Notice tone="info">{t("vote.notOpen.over")}</Notice>;
  }

  if (!account) {
    return (
      <div className="stack">
        <p>{t("vote.noWallet")}</p>
        <button type="button" className="btn btn--primary" onClick={openWallet}>
          {t("wallet.connect")}
        </button>
      </div>
    );
  }

  if (me.status === "ready" && !me.roles.member) {
    return (
      <div className="stack">
        <Notice tone="info">{t("vote.notMember")}</Notice>
        <p className="num wrap">{account}</p>
        <CopyButton value={account} label={t("wallet.copyAddress")} />
      </div>
    );
  }

  const submit = (event) => {
    event.preventDefault();
    if (choice === null) return;
    sender.send("vote", (signer) => contracts.voting.connect(signer).castVote(ballot.id, choice));
  };

  return (
    <form className="vote" onSubmit={submit}>
      <fieldset disabled={sender.busy}>
        <legend>{t("vote.choose")}</legend>
        <ul className="vote__options">
          {ballot.options.map((option, index) => (
            <li key={index}>
              <input type="radio" name={`ballot-${ballot.id}`} id={`opt-${ballot.id}-${index}`} value={index} checked={choice === index} onChange={() => setChoice(index)} />
              <label htmlFor={`opt-${ballot.id}-${index}`} dir="auto">
                {option}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="vote__review" aria-live="polite">
        {choice === null ? t("vote.pick") : t("vote.review", { option: ballot.options[choice], who: shorten(account) })}
      </p>
      <button type="submit" className="btn btn--primary" disabled={choice === null || sender.busy} aria-busy={sender.busy}>
        {sender.busy ? t("vote.casting") : t("vote.cast")}
      </button>
    </form>
  );
}
