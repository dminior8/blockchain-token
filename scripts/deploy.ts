import { network } from "hardhat";

async function main() {
    const { ethers } = await network.getOrCreate({ network: "sepolia" });

    const initialSupply = 1000000;
    const Token = await ethers.getContractFactory("MultiChainToken");

    console.log("Rozpoczynanie wdrożenia...");

    // Pobieramy TYLKO jedno konto (Twoje główne)
    const [deployer] = await ethers.getSigners();

    const token = await Token.deploy(initialSupply);
    await token.waitForDeployment();

    const address = await token.getAddress();
    const deployTx = token.deploymentTransaction();
    const deployReceipt = await deployTx?.wait();

    console.log(`\n--- WYNIKI WDROŻENIA (DEPLOYMENT) ---`);
    console.log(`Adres kontraktu: ${address}`);
    console.log(`Gas Used: ${deployReceipt?.gasUsed.toString()}`);
    console.log(`Gas Price: ${deployReceipt?.gasPrice.toString()}`);
    console.log(`Total Fee: ${deployReceipt?.fee.toString()}`);


    console.log("\nRozpoczynanie testowego transferu...");

    // Generujemy losowy adres wirtualny tylko po to, by mieć gdzie wysłać tokeny
    const dummyReceiver = ethers.Wallet.createRandom().address;

    // Przelewamy 100 tokenów (uwzględniając domyślne 18 miejsc po przecinku)
    // 100n * 10n**18n to bezpieczniejszy zapis w BigInt dla Ethers v6
    const amount = 100n * 10n ** 18n;
    const transferTx = await token.transfer(dummyReceiver, amount);
    const transferReceipt = await transferTx.wait();

    console.log(`--- WYNIKI TRANSFERU ---`);
    console.log(`Odbiorca (losowy): ${dummyReceiver}`);
    console.log(`Gas Used: ${transferReceipt?.gasUsed.toString()}`);
    console.log(`Gas Price: ${transferReceipt?.gasPrice.toString()}`);
    console.log(`Total Fee: ${transferReceipt?.fee.toString()}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});