import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      // Profil do badań - włączamy optymalizator zgodnie z punktem 4.1 projektu
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    // Symulacja lokalna
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // Sieci testowe do Twojego badania
    sepolia: {
      type: "http",
      chainType: "l1", // Layer 1 [cite: 173]
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    amoy: {
      type: "http",
      chainType: "l1", // Polygon PoS traktujemy tu jako sidechain (architektura L1)
      url: process.env.AMOY_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    arbitrumSepolia: {
      type: "http",
      chainType: "op", // Arbitrum to Optimistic Rollup
      url: process.env.ARBITRUM_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
});