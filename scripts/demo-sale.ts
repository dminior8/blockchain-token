import { network } from "hardhat";

/**
 * Pelne demo sprzedazy na lokalnej sieci EDR (hardhatMainnet).
 * Pokazuje:
 *   - blokade kupna przed startTime
 *   - kupno przez 2 uzytkownikow (alice, bob)
 *   - blokade claimu przed releaseTime
 *   - claim po releaseTime
 *   - withdrawProceeds po endTime
 *   - withdrawUnsold (tylko prefund) po releaseTime
 *
 * Dziala na obu wariantach kontraktu: TokenSaleApprove i TokenSalePrefund.
 */

type SaleLike = any;
type Provider = any;
type Signer = any;

async function increaseTimeTo(provider: Provider, target: number) {
    const latest = await provider.send("eth_getBlockByNumber", ["latest", false]);
    const now = parseInt(latest.timestamp, 16);
    const delta = target - now;
    if (delta > 0) {
        await provider.send("evm_increaseTime", [delta]);
    }
    await provider.send("evm_mine", []);
}

async function expectRevert(label: string, p: Promise<unknown>) {
    try {
        await p;
        console.log("  [FAIL]", label, "- nie zrewertowal sie");
    } catch (e: any) {
        const msg = (e?.shortMessage || e?.message || String(e)).slice(0, 140);
        console.log("  [OK]  ", label, "- revert:", msg);
    }
}

async function runScenario(
    label: string,
    sale: SaleLike,
    token: any,
    owner: Signer,
    alice: Signer,
    bob: Signer,
    treasury: string | undefined,
    ethersLib: any,
    provider: Provider,
    isPrefund: boolean
) {
    console.log("\n############################################################");
    console.log("# DEMO:", label);
    console.log("############################################################");

    const price = await sale.priceWeiPerToken();
    const startTime = Number(await sale.startTime());
    const endTime = Number(await sale.endTime());
    const releaseTime = Number(await sale.releaseTime());

    console.log("price/token:", ethersLib.formatEther(price), "ETH");
    console.log("startTime:  ", startTime, " endTime:", endTime, " releaseTime:", releaseTime);

    // 1) Proba kupna przed startem
    console.log("\n[1] Proba buyTokens przed startTime (powinno zrewertowac)");
    await expectRevert(
        "alice.buyTokens(5) przed startem",
        sale.connect(alice).buyTokens(5n, { value: 5n * price })
    );

    // 2) Przeskok do okna sprzedazy
    console.log("\n[2] evm_increaseTime -> wchodzimy w SaleOpen");
    await increaseTimeTo(provider, startTime + 1);
    console.log("   phase =", await sale.phase());

    // 3) Alice kupuje 30, Bob 20
    console.log("\n[3] alice.buyTokens(30), bob.buyTokens(20)");
    let tx = await sale.connect(alice).buyTokens(30n, { value: 30n * price });
    let rc = await tx.wait();
    console.log("  alice gas:", rc?.gasUsed.toString(), " ETH zaplacone:", ethersLib.formatEther(30n * price));
    tx = await sale.connect(bob).buyTokens(20n, { value: 20n * price });
    rc = await tx.wait();
    console.log("  bob   gas:", rc?.gasUsed.toString(), " ETH zaplacone:", ethersLib.formatEther(20n * price));
    console.log("  tokensSold:", (await sale.tokensSold()).toString(), "/ tokensForSale:", (await sale.tokensForSale()).toString());

    // 4) Bledne kupno - zla kwota
    console.log("\n[4] Proba buyTokens(10) z nieprawidlowa kwota (powinno zrewertowac)");
    await expectRevert(
        "zla kwota ETH",
        sale.connect(alice).buyTokens(10n, { value: 1n })
    );

    // 5) Proba claim za wczesnie (przed releaseTime)
    console.log("\n[5] Proba claim() przed releaseTime (powinno zrewertowac)");
    await expectRevert(
        "alice.claim() przed releaseTime",
        sale.connect(alice).claim()
    );

    // 6) Przeskok do releaseTime
    console.log("\n[6] evm_increaseTime -> wchodzimy w ClaimOpen");
    await increaseTimeTo(provider, releaseTime + 1);
    console.log("   phase =", await sale.phase());

    // 7) Claim
    console.log("\n[7] alice.claim(), bob.claim()");
    const aliceBalBefore = await token.balanceOf(await alice.getAddress());
    const bobBalBefore = await token.balanceOf(await bob.getAddress());
    tx = await sale.connect(alice).claim();
    rc = await tx.wait();
    console.log("  alice gas:", rc?.gasUsed.toString());
    tx = await sale.connect(bob).claim();
    rc = await tx.wait();
    console.log("  bob   gas:", rc?.gasUsed.toString());
    const aliceBalAfter = await token.balanceOf(await alice.getAddress());
    const bobBalAfter = await token.balanceOf(await bob.getAddress());
    console.log("  alice token delta:", ethersLib.formatUnits(aliceBalAfter - aliceBalBefore, 18));
    console.log("  bob   token delta:", ethersLib.formatUnits(bobBalAfter - bobBalBefore, 18));

    // 8) Drugi claim - revert
    console.log("\n[8] Proba podwojnego claim() przez alice (powinno zrewertowac)");
    await expectRevert("podwojny claim", sale.connect(alice).claim());

    // 9) withdrawProceeds przez ownera
    console.log("\n[9] owner.withdrawProceeds()");
    const ethBefore = await provider.send("eth_getBalance", [await owner.getAddress(), "latest"]);
    tx = await sale.connect(owner).withdrawProceeds(await owner.getAddress());
    rc = await tx.wait();
    const ethAfter = await provider.send("eth_getBalance", [await owner.getAddress(), "latest"]);
    console.log("  gas:", rc?.gasUsed.toString(), "delta ETH:", ethersLib.formatEther(BigInt(ethAfter) - BigInt(ethBefore)));

    // 10) withdrawUnsold (tylko prefund)
    if (isPrefund) {
        console.log("\n[10] owner.withdrawUnsold() - prefund only");
        const ownerTokensBefore = await token.balanceOf(await owner.getAddress());
        tx = await sale.connect(owner).withdrawUnsold(await owner.getAddress());
        rc = await tx.wait();
        const ownerTokensAfter = await token.balanceOf(await owner.getAddress());
        console.log("  gas:", rc?.gasUsed.toString(), " odzyskane tokeny:", ethersLib.formatUnits(ownerTokensAfter - ownerTokensBefore, 18));
    }

    void treasury; // unused parametr (rezerwa pod ewentualny inny wariant)
}

async function main() {
    const networkName = process.env.NETWORK || "hardhatMainnet";
    const { ethers } = await network.getOrCreate({ network: networkName });
    const provider = ethers.provider;

    const signers = await ethers.getSigners();
    const [owner, alice, bob] = signers;
    console.log("Owner:", await owner.getAddress());
    console.log("Alice:", await alice.getAddress());
    console.log("Bob:  ", await bob.getAddress());

    // Wspolne parametry sprzedazy
    const latestBlock = await provider.getBlock("latest");
    const chainNow = Number(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
    const startTime = chainNow + 60;
    const endTime = startTime + 3600;
    const releaseTime = endTime + 600;
    const priceWeiPerToken = ethers.parseEther("0.01");
    const tokensForSale = 100n;
    const initialSupply = 1_000_000n;

    // === Token ===
    console.log("\n*** Deploy MultiChainToken ***");
    const Token = await ethers.getContractFactory("MultiChainToken");
    const token = await Token.deploy(initialSupply);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("Token:", tokenAddress);

    // === Wariant A: Approve ===
    console.log("\n*** Deploy TokenSaleApprove ***");
    const SaleApprove = await ethers.getContractFactory("TokenSaleApprove");
    const saleApprove = await SaleApprove.deploy(
        tokenAddress,
        await owner.getAddress(),
        priceWeiPerToken,
        startTime,
        endTime,
        releaseTime,
        tokensForSale
    );
    await saleApprove.waitForDeployment();
    const saleApproveAddr = await saleApprove.getAddress();
    console.log("SaleApprove:", saleApproveAddr);

    // approve calej puli
    const baseUnits = tokensForSale * 10n ** 18n;
    await (await token.approve(saleApproveAddr, baseUnits)).wait();
    console.log("approve(saleApprove, ", baseUnits.toString(), ") OK");

    await runScenario(
        "TokenSaleApprove (approve + transferFrom)",
        saleApprove,
        token,
        owner,
        alice,
        bob,
        await owner.getAddress(),
        ethers,
        provider,
        false
    );

    // === Wariant B: Prefund ===
    // Druga sprzedaz musi miec startTime > obecnego block.timestamp (po time-travel).
    const latestBlock2 = await provider.getBlock("latest");
    const chainNow2 = Number(latestBlock2?.timestamp ?? Math.floor(Date.now() / 1000));
    const startTime2 = chainNow2 + 60;
    const endTime2 = startTime2 + 3600;
    const releaseTime2 = endTime2 + 600;

    console.log("\n*** Deploy TokenSalePrefund ***");
    const SalePrefund = await ethers.getContractFactory("TokenSalePrefund");
    const salePrefund = await SalePrefund.deploy(
        tokenAddress,
        priceWeiPerToken,
        startTime2,
        endTime2,
        releaseTime2,
        tokensForSale
    );
    await salePrefund.waitForDeployment();
    const salePrefundAddr = await salePrefund.getAddress();
    console.log("SalePrefund:", salePrefundAddr);

    await (await token.transfer(salePrefundAddr, baseUnits)).wait();
    console.log("transfer(salePrefund, ", baseUnits.toString(), ") OK");

    await runScenario(
        "TokenSalePrefund (prefund + transfer)",
        salePrefund,
        token,
        owner,
        alice,
        bob,
        undefined,
        ethers,
        provider,
        true
    );

    console.log("\n=== DEMO ZAKONCZONE POMYSLNIE ===");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
