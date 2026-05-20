# Multi-Chain ERC-20 Token & Economic Analysis

This project showcases a Hardhat 3 Beta environment using TypeScript and the `ethers` (v6) library. Its primary goal is to deploy an ERC-20 smart contract across different blockchain architectures (Layer 1, Sidechains, and Layer 2 Rollups) to analyze and compare the real-world gas costs of contract deployment and token transfers.

To learn more about the Hardhat 3 Beta, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join the [Hardhat 3 Beta](https://hardhat.org/hardhat3-beta-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in their GitHub issue tracker.

## Project Overview

This research project includes:
- **`contracts/MultiChainToken.sol`**: An OpenZeppelin-based ERC-20 smart contract.
- **`contracts/TokenSaleApprove.sol`**: Time-windowed token sale + vesting (claim after release), tokens are pulled from the owner's wallet via `transferFrom` — the classic approve-pattern ICO.
- **`contracts/TokenSalePrefund.sol`**: Same idea, but the contract is pre-funded with tokens up front; `claim()` simply calls `transfer` from the contract's own balance. Adds `withdrawUnsold()`.
- **`scripts/deploy.ts`**: The original execution and analysis script. Deploys the token, performs a test transfer, prints gas/fee data.
- **`scripts/deploy-sale.ts`**: Deploys the token plus both sale contracts on a chosen network and funds them (approve for variant A, transfer for variant B).
- **`scripts/demo-sale.ts`**: Runs an end-to-end scenario on the local EDR node with time-travel (start → sale → release → claim → withdraw) for both sale variants.
- **`test/TokenSale.ts`**: Mocha/Chai tests covering both sale contracts (window enforcement, supply cap, double-claim, withdraw flows, etc.).
- **Hardhat 3 Configuration**: Configured to connect to multiple network types, including Ethereum L1 (`sepolia`), Polygon PoS (`amoy`), and Optimistic Rollups (`arbitrumSepolia`).

## Environment Setup

Before running the deployment and analysis, **you must configure your local environment variables**. 

1. Create a `.env` file in the root directory of your project.
2. Add your private key and the RPC URLs (e.g., from Alchemy) for the networks you wish to test:

```env
# Your wallet's private key (DO NOT share this or commit it to GitHub)
PRIVATE_KEY=your_private_key_here

# RPC URLs
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
AMOY_RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
ARBITRUM_RPC_URL=https://arb-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
```

*Note: Ensure that `.env` is included in your `.gitignore` file to keep your private key secure.*

## Usage: Running the Economic Analysis

Unlike standard Hardhat projects that use Ignition modules, this project relies on a custom `deploy.ts` script to handle both deployment and cost analysis in a single run.

To deploy the token, execute a test transfer, and view the economic analysis, run the script against your desired network:

**For Ethereum Sepolia (L1 Benchmark):**
```shell
npx hardhat run scripts/deploy.ts --network sepolia
```

**For Polygon Amoy (Sidechain):**
```shell
npx hardhat run scripts/deploy.ts --network amoy
```

**For Arbitrum Sepolia (L2 Rollup):**
```shell
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

### Expected Output
Upon successful execution, the script will output:
1. The deployed contract address.
2. The exact `Gas Used` for both the deployment and a standard `transfer` operation.
3. The live `Gas Price` fetched directly from the network's RPC.
4. A calculated USD estimate demonstrating the cost difference between L1 and L2 infrastructures.

## Token Sale + Vesting (rozszerzenie ERC-20)

Bazowy ERC-20 zostaje nietknięty (`MultiChainToken`), a obok dorzuciliśmy dwa kontrakty sprzedażowe pokazujące **dwa różne sposoby dystrybucji** tych samych tokenów z **oknem czasowym sprzedaży** i **vestingiem (claim po `releaseTime`)**.

### Wspólne fazy

```
BeforeStart -> SaleOpen [startTime, endTime] -> SaleClosed [endTime, releaseTime) -> ClaimOpen [releaseTime, +inf)
```

W oknie `SaleOpen` można wywołać `buyTokens(qty)` z `msg.value == qty * priceWeiPerToken` — zakup zostaje zaksięgowany w `purchased[buyer]`. Tokeny pojawiają się w portfelu kupującego dopiero po `releaseTime`, gdy wywoła `claim()`. Owner odbiera zebrane ETH przez `withdrawProceeds(to)` po `endTime`.

### Wariant A: `TokenSaleApprove` (approve + transferFrom)

Klasyczny ICO approve-pattern. Przed `startTime` właściciel tokenów (`treasury`) musi wykonać:

```
token.approve(saleAddress, tokensForSale * 10**decimals)
```

Tokeny **nie** są przenoszone do kontraktu sprzedaży — siedzą w portfelu `treasury` do momentu, w którym kupujący sam wywoła `claim()`. Wtedy kontrakt wykonuje `token.transferFrom(treasury, msg.sender, qty * 1e18)`.

Plusy: nie zamrażasz tokenów w obcym kontrakcie, łatwo cofnąć zezwolenie (`approve(sale, 0)`).
Minusy: jeśli `treasury` w międzyczasie wytransferuje tokeny gdzie indziej, claim się nie uda.

### Wariant B: `TokenSalePrefund` (prefund + transfer)

Owner przed startem przesyła całą pulę tokenów bezpośrednio na adres kontraktu:

```
token.transfer(saleAddress, tokensForSale * 10**decimals)
```

`claim()` to po prostu `token.transfer(msg.sender, qty * 1e18)` z balansu kontraktu. Dodatkowa funkcja `withdrawUnsold(to)` (po `releaseTime`, raz) pozwala odzyskać niesprzedaną resztę.

Plusy: claim nie zależy od zewnętrznego allowance, prostsze do audytu.
Minusy: tokeny są zamrożone w kontrakcie aż do końca cyklu.

### Uruchomienie

Deploy obu sale + tokena na Sepolii (lub innej sieci z `hardhat.config.ts`):

```shell
npm run deploy:sale
# albo z parametrami:
#   $env:NETWORK="sepolia"; $env:TOKENS_FOR_SALE="100"; $env:PRICE_ETH_PER_TOKEN="0.0001"; npm run deploy:sale
```

Skrypt drukuje adresy obu kontraktów, parametry okna sprzedaży, gas usage i wykonuje:
- `token.approve(saleApprove, tokensForSale * 1e18)` — zasilenie wariantu A
- `token.transfer(salePrefund, tokensForSale * 1e18)` — zasilenie wariantu B

Pełne demo end-to-end na lokalnym EDR (z time-travelem przez `evm_increaseTime`):

```shell
npm run demo:sale
```

Demo dla każdego z dwóch wariantów wykonuje: kupno przed startem (revert) → kupno w oknie (alice 30, bob 20) → kupno ze złą kwotą (revert) → claim przed releaseTime (revert) → claim po releaseTime → podwójny claim (revert) → `withdrawProceeds` ownera. Dla wariantu prefund dodatkowo `withdrawUnsold`.

Testy mocha/chai:

```shell
npm test
```

### Konfiguracja parametrów sprzedaży

| zmienna env             | default       | opis                                     |
|-------------------------|---------------|------------------------------------------|
| `NETWORK`               | `sepolia`     | nazwa sieci z `hardhat.config.ts`        |
| `INITIAL_SUPPLY`        | `1000000`     | początkowa podaż tokena (whole tokens)   |
| `TOKENS_FOR_SALE`       | `100`         | ile całych tokenów sprzedać w sale       |
| `PRICE_ETH_PER_TOKEN`   | `0.0001`      | cena 1 tokena w ETH                      |
| `SALE_START_DELAY_S`    | `120`         | sekundy od `now` do `startTime`          |
| `SALE_DURATION_S`       | `3600`        | długość okna sprzedaży w sekundach       |
| `VESTING_AFTER_END_S`   | `3600`        | sekundy od `endTime` do `releaseTime`    |
