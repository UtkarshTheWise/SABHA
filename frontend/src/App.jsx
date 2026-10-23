/**
 * The shell: language, routing, then the network and everything that depends on it.
 * Choosing another network remounts everything below it, so nothing from the old
 * one (a signer, a ballot list) can leak into the new.
 */
import { useState } from "react";

import { LocaleProvider, useLocale } from "./i18n/index.jsx";
import { initialNetwork } from "./lib/networks.js";
import { Link, RouterProvider, useRoute } from "./router.jsx";
import { ChainProvider } from "./state/chain.jsx";
import { NetworkProvider } from "./state/network.jsx";
import { UiProvider } from "./state/ui.jsx";
import { WalletProvider } from "./state/wallet.jsx";
import Footer from "./components/Footer.jsx";
import PageHeader from "./components/PageHeader.jsx";
import { EmptyState } from "./components/States.jsx";
import TopBar from "./components/TopBar.jsx";
import WalletDialog from "./components/WalletDialog.jsx";
import Ballot from "./pages/Ballot.jsx";
import Ballots from "./pages/Ballots.jsx";
import Mine from "./pages/Mine.jsx";
import NetworkHealth from "./pages/NetworkHealth.jsx";
import Officer from "./pages/Officer.jsx";

function NotFound() {
  const { t } = useLocale();
  return (
    <>
      <PageHeader title={t("notFound.title")} />
      <EmptyState
        title={t("notFound.heading")}
        action={
          <Link to={[]} className="btn">
            {t("ballot.back")}
          </Link>
        }
      >
        {t("notFound.body")}
      </EmptyState>
    </>
  );
}

function Pages() {
  const { path } = useRoute();
  switch (path[0]) {
    case undefined:
      return <Ballots />;
    case "ballot":
      return <Ballot />;
    case "mine":
      return <Mine />;
    case "officer":
      return <Officer />;
    case "network":
      return <NetworkHealth />;
    default:
      return <NotFound />;
  }
}

function Shell({ onNetwork }) {
  const [walletOpen, setWalletOpen] = useState(false);
  return (
    <UiProvider value={{ openWallet: () => setWalletOpen(true) }}>
      <div className="page">
        <TopBar onNetwork={onNetwork} />
        <main id="main" tabIndex={-1} className="container">
          <div className="slip">
            <Pages />
          </div>
        </main>
        <Footer />
      </div>
      <WalletDialog open={walletOpen} onClose={() => setWalletOpen(false)} />
    </UiProvider>
  );
}

function NoNetwork() {
  const { t } = useLocale();
  return (
    <main id="main" tabIndex={-1} className="container">
      <PageHeader title={t("noNetwork.title")} lede={t("noNetwork.body")} />
    </main>
  );
}

function Root() {
  const [network, setNetwork] = useState(initialNetwork);
  if (!network) return <NoNetwork />;
  return (
    <NetworkProvider key={network.key} network={network}>
      <WalletProvider>
        <ChainProvider>
          <Shell onNetwork={setNetwork} />
        </ChainProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <RouterProvider>
        <Root />
      </RouterProvider>
    </LocaleProvider>
  );
}
