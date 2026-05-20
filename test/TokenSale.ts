import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.getOrCreate();

async function blockTs(): Promise<number> {
    const b = await ethers.provider.getBlock("latest");
    return Number(b!.timestamp);
}

async function timeTravelTo(ts: number) {
    const now = await blockTs();
    const delta = ts - now;
    if (delta > 0) {
        await ethers.provider.send("evm_increaseTime", [delta]);
    }
    await ethers.provider.send("evm_mine", []);
}

async function deployToken(initialSupply: bigint) {
    const Token = await ethers.getContractFactory("MultiChainToken");
    const token = await Token.deploy(initialSupply);
    await token.waitForDeployment();
    return token;
}

interface Times {
    startTime: number;
    endTime: number;
    releaseTime: number;
}

async function makeTimes(): Promise<Times> {
    const now = await blockTs();
    return {
        startTime: now + 100,
        endTime: now + 100 + 3600,
        releaseTime: now + 100 + 3600 + 600,
    };
}

const BASE = 10n ** 18n;
const PRICE = ethers.parseEther("0.01");
const TOKENS_FOR_SALE = 100n;

describe("TokenSaleApprove", function () {
    let owner: any;
    let alice: any;
    let bob: any;
    let token: any;
    let sale: any;
    let times: Times;

    beforeEach(async function () {
        [owner, alice, bob] = await ethers.getSigners();
        token = await deployToken(1_000_000n);
        times = await makeTimes();

        const Sale = await ethers.getContractFactory("TokenSaleApprove");
        sale = await Sale.deploy(
            await token.getAddress(),
            await owner.getAddress(),
            PRICE,
            times.startTime,
            times.endTime,
            times.releaseTime,
            TOKENS_FOR_SALE
        );
        await sale.waitForDeployment();

        await (await token.approve(await sale.getAddress(), TOKENS_FOR_SALE * BASE)).wait();
    });

    it("zwraca BeforeStart przed startTime", async function () {
        expect(await sale.phase()).to.equal(0n);
    });

    it("blokuje buyTokens przed startTime", async function () {
        await expect(
            sale.connect(alice).buyTokens(1n, { value: PRICE })
        ).to.be.revertedWithCustomError(sale, "SaleNotStarted");
    });

    it("blokuje buyTokens z nieprawidlowa kwota ETH", async function () {
        await timeTravelTo(times.startTime + 1);
        await expect(
            sale.connect(alice).buyTokens(2n, { value: PRICE })
        ).to.be.revertedWithCustomError(sale, "IncorrectPayment");
        await expect(
            sale.connect(alice).buyTokens(2n, { value: 3n * PRICE })
        ).to.be.revertedWithCustomError(sale, "IncorrectPayment");
    });

    it("akceptuje kupno i akumuluje purchased[]", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(10n, { value: 10n * PRICE })).wait();
        await (await sale.connect(alice).buyTokens(5n, { value: 5n * PRICE })).wait();
        expect(await sale.purchased(await alice.getAddress())).to.equal(15n);
        expect(await sale.tokensSold()).to.equal(15n);
        expect(await sale.tokensRemaining()).to.equal(TOKENS_FOR_SALE - 15n);
    });

    it("blokuje sprzedaz powyzej tokensForSale", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(TOKENS_FOR_SALE, { value: TOKENS_FOR_SALE * PRICE })).wait();
        await expect(
            sale.connect(bob).buyTokens(1n, { value: PRICE })
        ).to.be.revertedWithCustomError(sale, "SoldOut");
    });

    it("blokuje claim przed releaseTime", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(3n, { value: 3n * PRICE })).wait();
        await expect(sale.connect(alice).claim()).to.be.revertedWithCustomError(
            sale,
            "ReleaseNotReached"
        );
    });

    it("claim po releaseTime przelewa tokeny przez transferFrom(treasury)", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(7n, { value: 7n * PRICE })).wait();
        await timeTravelTo(times.releaseTime + 1);

        const before = await token.balanceOf(await alice.getAddress());
        await (await sale.connect(alice).claim()).wait();
        const after = await token.balanceOf(await alice.getAddress());
        expect(after - before).to.equal(7n * BASE);
    });

    it("blokuje podwojny claim", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(2n, { value: 2n * PRICE })).wait();
        await timeTravelTo(times.releaseTime + 1);
        await (await sale.connect(alice).claim()).wait();
        await expect(sale.connect(alice).claim()).to.be.revertedWithCustomError(
            sale,
            "AlreadyClaimed"
        );
    });

    it("nic-do-claimu reverti dla niekupujacych", async function () {
        await timeTravelTo(times.releaseTime + 1);
        await expect(sale.connect(alice).claim()).to.be.revertedWithCustomError(
            sale,
            "NothingToClaim"
        );
    });

    it("blokuje withdrawProceeds dopoki sprzedaz trwa", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(1n, { value: PRICE })).wait();
        await expect(
            sale.connect(owner).withdrawProceeds(await owner.getAddress())
        ).to.be.revertedWithCustomError(sale, "SaleStillOpen");
    });

    it("withdrawProceeds dziala tylko dla ownera", async function () {
        await timeTravelTo(times.endTime + 1);
        await expect(
            sale.connect(alice).withdrawProceeds(await alice.getAddress())
        ).to.be.revertedWithCustomError(sale, "OwnableUnauthorizedAccount");
    });

    it("withdrawProceeds wyplaca ETH ownerowi po endTime", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(4n, { value: 4n * PRICE })).wait();
        await timeTravelTo(times.endTime + 1);

        const before = await ethers.provider.getBalance(await bob.getAddress());
        await (await sale.connect(owner).withdrawProceeds(await bob.getAddress())).wait();
        const after = await ethers.provider.getBalance(await bob.getAddress());
        expect(after - before).to.equal(4n * PRICE);
    });

    it("reverti deploy z startTime w przeszlosci", async function () {
        const Sale = await ethers.getContractFactory("TokenSaleApprove");
        const past = (await blockTs()) - 1000;
        await expect(
            Sale.deploy(
                await token.getAddress(),
                await owner.getAddress(),
                PRICE,
                past,
                past + 100,
                past + 200,
                TOKENS_FOR_SALE
            )
        ).to.be.revertedWithCustomError(Sale, "InvalidTimes");
    });
});

describe("TokenSalePrefund", function () {
    let owner: any;
    let alice: any;
    let bob: any;
    let token: any;
    let sale: any;
    let times: Times;

    beforeEach(async function () {
        [owner, alice, bob] = await ethers.getSigners();
        token = await deployToken(1_000_000n);
        times = await makeTimes();

        const Sale = await ethers.getContractFactory("TokenSalePrefund");
        sale = await Sale.deploy(
            await token.getAddress(),
            PRICE,
            times.startTime,
            times.endTime,
            times.releaseTime,
            TOKENS_FOR_SALE
        );
        await sale.waitForDeployment();

        await (await token.transfer(await sale.getAddress(), TOKENS_FOR_SALE * BASE)).wait();
    });

    it("blokuje kupno bez prefundu", async function () {
        const Sale = await ethers.getContractFactory("TokenSalePrefund");
        const t = await makeTimes();
        const empty = await Sale.deploy(
            await token.getAddress(),
            PRICE,
            t.startTime,
            t.endTime,
            t.releaseTime,
            TOKENS_FOR_SALE
        );
        await empty.waitForDeployment();
        await timeTravelTo(t.startTime + 1);
        await expect(
            empty.connect(alice).buyTokens(1n, { value: PRICE })
        ).to.be.revertedWithCustomError(empty, "NotPrefunded");
    });

    it("buy + claim flow", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(10n, { value: 10n * PRICE })).wait();
        await timeTravelTo(times.releaseTime + 1);
        const before = await token.balanceOf(await alice.getAddress());
        await (await sale.connect(alice).claim()).wait();
        const after = await token.balanceOf(await alice.getAddress());
        expect(after - before).to.equal(10n * BASE);
    });

    it("withdrawUnsold po releaseTime, raz", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(20n, { value: 20n * PRICE })).wait();
        await timeTravelTo(times.releaseTime + 1);

        const ownerBefore = await token.balanceOf(await owner.getAddress());
        await (await sale.connect(owner).withdrawUnsold(await owner.getAddress())).wait();
        const ownerAfter = await token.balanceOf(await owner.getAddress());
        expect(ownerAfter - ownerBefore).to.equal((TOKENS_FOR_SALE - 20n) * BASE);

        await expect(
            sale.connect(owner).withdrawUnsold(await owner.getAddress())
        ).to.be.revertedWithCustomError(sale, "AlreadyWithdrawn");
    });

    it("withdrawUnsold blokowany przed releaseTime", async function () {
        await timeTravelTo(times.endTime + 1);
        await expect(
            sale.connect(owner).withdrawUnsold(await owner.getAddress())
        ).to.be.revertedWithCustomError(sale, "ReleaseNotReached");
    });

    it("claimableOf zwraca 0 przed releaseTime i po claim", async function () {
        await timeTravelTo(times.startTime + 1);
        await (await sale.connect(alice).buyTokens(5n, { value: 5n * PRICE })).wait();
        expect(await sale.claimableOf(await alice.getAddress())).to.equal(0n);

        await timeTravelTo(times.releaseTime + 1);
        expect(await sale.claimableOf(await alice.getAddress())).to.equal(5n * BASE);

        await (await sale.connect(alice).claim()).wait();
        expect(await sale.claimableOf(await alice.getAddress())).to.equal(0n);
    });

    it("phase() przechodzi 0 -> 1 -> 2 -> 3", async function () {
        expect(await sale.phase()).to.equal(0n);
        await timeTravelTo(times.startTime + 1);
        expect(await sale.phase()).to.equal(1n);
        await timeTravelTo(times.endTime + 1);
        expect(await sale.phase()).to.equal(2n);
        await timeTravelTo(times.releaseTime + 1);
        expect(await sale.phase()).to.equal(3n);
    });
});
