The target of this development is to allow the frontend to easily get the proper balance of the user account, rather than the real value of this account, but the underlying asset of one account.

Using aave SDK to facilitate the development
npm install @aave/client@latest


AAVE balance gets
1, function get_userBalance(Chain_ID, AAVE, account_address, usd), return the underling vaule of user account in USD
2, configure the target AAVE market address [market1, market2, market3, ....., marketn]
3. The code can leverage
import { userSupplies } from "@aave/client/actions";
import { evmAddress } from "@aave/client";
import { client } from "./client";
import { markets } from "./markets";

const user = evmAddress("0x742d35cc6e5c4ce3b69a2a8c7c8e5f7e9a0b1234");

const result = await userSupplies(client, {
  markets,
  user,
});

if (result.isErr()) {
  console.error("Supplies error:", result.error);
} else {
  // result.value: MarketUserReserveSupplyPosition[]
  console.log(result.value);
}

4. Key is using the number of stablecoin aToken as the USD vaule to return to the frontend, for example, the 100 aUSDT+120 aUSDC as the 220 USD
5. Key is if get the number from the result.vaule, we just query the latest eth price, using this price*amount of eth to return the USD balance  

compound balance gets
1, function get_userBalance(Chain_ID, compund, account_address, usd)
2, leverage the getBalance( asset, userAddress) of compoundSDK, get the supplied Amount.
3, for the whole USD value, we use the getBalance function to get the balance for each market in the config. For example, there are USDC, USDT, USDBC, WETH in config, so we use the Supplied Amount of (USDC+USDT+USDBC) + the  Supplied Amount of WETH * WETH price = the total supplied value in compound in USD

pendle
1, function get_userBalance(Chain_ID, pendle, account_address, usd)
2, leverage the getPtBalance(MARKET, targetAddress) of Pendle SDK, get the pt amount of this market
2, For the whole USD value, we use this function to query the PT amount of every market that is recorded in the config, and return the sum of all PT balances of these markets.



给unified 增加一个config内容
内容为
按照链分类的，认定为stablecoin的address名称与地址列表
认定为资产的名称与地址列表
比如
base：
USDC，address：
USDF，address：
weth，address
wbtc，address

ethereum
。。。

op
，，，
其他链同理。

再增加了这个config之后

我要实现的是
升级getUnifiedBalanceSummar
在原本获得协议balance的基础上
再balanceof获得稳定币的balance

这样就可以获得用户的总体状况了，即是，可用余额，和存款余额