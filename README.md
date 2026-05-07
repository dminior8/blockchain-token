# Multi-Chain ERC-20 Token & Economic Analysis

This project showcases a Hardhat 3 Beta environment using TypeScript and the `ethers` (v6) library. Its primary goal is to deploy an ERC-20 smart contract across different blockchain architectures (Layer 1, Sidechains, and Layer 2 Rollups) to analyze and compare the real-world gas costs of contract deployment and token transfers.

To learn more about the Hardhat 3 Beta, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join the [Hardhat 3 Beta](https://hardhat.org/hardhat3-beta-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in their GitHub issue tracker.

## Project Overview

This research project includes:
- **`contracts/MultiChainToken.sol`**: An OpenZeppelin-based ERC-20 smart contract.
- **`scripts/deploy.ts`**: The core execution and analysis script. It deploys the contract, performs a test token transfer, fetches live network fee data, and calculates the economic cost in USD.
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

*** You can copy and paste this directly into your `README.md` file. It accurately reflects your methodology and provides clear instructions for anyone reviewing your project!
