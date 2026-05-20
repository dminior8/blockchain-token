import { network } from "hardhat";

/**
 * Wdrazanie pelnego zestawu: MultiChainToken + TokenSaleApprove + TokenSalePrefund.
 *
 * Parametry mozna nadpisac przez zmienne srodowiskowe:
 *   NETWORK             - siec hardhat (default: sepolia)
 *   INITIAL_SUPPLY      - poczatkowa podaz tokena w "calych tokenach" (default: 1_000_000)
 *   TOKENS_FOR_SALE     - liczba calych tokenow do sprzedazy w kazdym sale (default: 100)
 *   PRICE_ETH_PER_TOKEN - cena za 1 caly token w ETH (default: 0.0001)
 *   SALE_START_DELAY_S  - opoznienie startu od now (default: 120)
 *   SALE_DURATION_S     - dlugosc okna sprzedazy (default: 3600)
 *   VESTING_AFTER_END_S - ile sek po endTime tokeny staja sie odbieralne (default: 3600)
 *
 * Po deployu wykonuje:
 *   - token.approve(saleApprove, tokensForSale * 1e18)   -- zasilanie wariantu A
 *   - token.transfer(salePrefund, tokensForSale * 1e18)  -- zasilanie wariantu B
 */
async function main() {
    const networkName = process.env.NETWORK || "sepolia";
    const { ethers } = await network.getOrCreate({ network: networkName });

    const initialSupply = BigInt(process.env.INITIAL_SUPPLY || "1000000");
    const tokensForSale = BigInt(process.env.TOKENS_FOR_SALE || "100");
    const priceWeiPerToken = ethers.parseEther(
        process.env.PRICE_ETH_PER_TOKEN || "0.0001"
    );
    const startDelay = Number(process.env.SALE_START_DELAY_S || "120");
    const saleDuration = Number(process.env.SALE_DURATION_S || "3600");
    const vestingAfter = Number(process.env.VESTING_AFTER_END_S || "3600");

    const [deployer] = await ethers.getSigners();
    console.log("Network:        ", networkName);
    console.log("Deployer:       ", deployer.address);
    const deployerBal = await ethers.provider.getBalance(deployer.address);
    console.log("Deployer balance:", ethers.formatEther(deployerBal), "ETH");

    console.log("\n=== 1/4 Deploy MultiChainToken ===");
    const Token = await ethers.getContractFactory("MultiChainToken");
    const token = await Token.deploy(initialSupply);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    const tokenDeployTx = token.deploymentTransaction();
    const tokenReceipt = await tokenDeployTx?.wait();
    console.log("Token address:  ", tokenAddress);
    console.log("Gas used:       ", tokenReceipt?.gasUsed.toString());

    const latestBlock = await ethers.provider.getBlock("latest");
    const chainNow = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
    const startTime = chainNow + startDelay;
    const endTime = startTime + saleDuration;
    const releaseTime = endTime + vestingAfter;

    console.log("\n=== Sale parameters ===");
    console.log("startTime:      ", startTime, "(" + new Date(startTime * 1000).toISOString() + ")");
    console.log("endTime:        ", endTime, "(" + new Date(endTime * 1000).toISOString() + ")");
    console.log("releaseTime:    ", releaseTime, "(" + new Date(releaseTime * 1000).toISOString() + ")");
    console.log("priceWeiPerToken:", priceWeiPerToken.toString(), "(" + ethers.formatEther(priceWeiPerToken) + " ETH/token)");
    console.log("tokensForSale:  ", tokensForSale.toString());

    console.log("\n=== 2/4 Deploy TokenSaleApprove (approve-pattern) ===");
    const SaleApprove = await ethers.getContractFactory("TokenSaleApprove");
    const saleApprove = await SaleApprove.deploy(
        tokenAddress,
        deployer.address,
        priceWeiPerToken,
        startTime,
        endTime,
        releaseTime,
        tokensForSale
    );
    await saleApprove.waitForDeployment();
    const saleApproveAddr = await saleApprove.getAddress();
    const saAReceipt = await saleApprove.deploymentTransaction()?.wait();
    console.log("Sale (approve): ", saleApproveAddr);
    console.log("Gas used:       ", saAReceipt?.gasUsed.toString());

    console.log("\n=== 3/4 Deploy TokenSalePrefund (prefund-pattern) ===");
    const SalePrefund = await ethers.getContractFactory("TokenSalePrefund");
    const salePrefund = await SalePrefund.deploy(
        tokenAddress,
        priceWeiPerToken,
        startTime,
        endTime,
        releaseTime,
        tokensForSale
    );
    await salePrefund.waitForDeployment();
    const salePrefundAddr = await salePrefund.getAddress();
    const saPReceipt = await salePrefund.deploymentTransaction()?.wait();
    console.log("Sale (prefund): ", salePrefundAddr);
    console.log("Gas used:       ", saPReceipt?.gasUsed.toString());

    const baseUnits = tokensForSale * 10n ** 18n;

    console.log("\n=== 4/4 Zasilanie obu sale ===");
    console.log("token.approve(saleApprove, ", baseUnits.toString(), ")");
    const approveTx = await token.approve(saleApproveAddr, baseUnits);
    const approveReceipt = await approveTx.wait();
    console.log("  gas:", approveReceipt?.gasUsed.toString());

    console.log("token.transfer(salePrefund, ", baseUnits.toString(), ")");
    const transferTx = await token.transfer(salePrefundAddr, baseUnits);
    const transferReceipt = await transferTx.wait();
    console.log("  gas:", transferReceipt?.gasUsed.toString());

    console.log("\n=== Podsumowanie ===");
    console.log("Token:              ", tokenAddress);
    console.log("Sale (approve):     ", saleApproveAddr);
    console.log("Sale (prefund):     ", salePrefundAddr);
    console.log("Allowance dla A:    ", (await token.allowance(deployer.address, saleApproveAddr)).toString());
    console.log("Balance P (prefund):", (await token.balanceOf(salePrefundAddr)).toString());
    console.log("\nWAZNE: kupujacy musza poczekac do startTime, a odbiorcy do releaseTime.");
    console.log("Mozna teraz zawolac buyTokens(qty) z odpowiednia kwota ETH na ktorymkolwiek sale.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
