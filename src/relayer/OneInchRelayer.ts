import { ethers } from 'ethers'
import { Contract } from '@ethersproject/contracts'

import Relayer from './Relayer'
import { logger, getGasPrice } from '../utils'
import { Order } from '../book/types'
import { ONEINCH_HANDLER_ADDRESSES, ETH_ADDRESS } from '../contracts'
import HandlerABI from '../contracts/abis/Handler.json'
import OneSplitABI from '../contracts/abis/OneSplit.json'

export default class OneInchRelayer {
  base: Relayer
  oneInchHandler: Contract

  constructor(base: Relayer) {
    this.base = base

    this.oneInchHandler = new Contract(
      ONEINCH_HANDLER_ADDRESSES[base.chainId],
      HandlerABI,
      base.account
    )
  }

  async execute(order: Order): Promise<string | undefined> {
    const parts = 10
    const CONTRACT_ADDRESS = '0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E'
    const contract = new Contract(
      CONTRACT_ADDRESS,
      OneSplitABI,
      this.base.account
    )
    const splitExchanges = this.getSplitExchanges()
    try {
      // Get handler to use
      const handler = this.oneInchHandler
      let distributionsA = []
      let distributionsB = []
      let expectedOut

      const isTokenToToken =
        order.inputToken !== ETH_ADDRESS && order.outputToken !== ETH_ADDRESS

      if (isTokenToToken) {
        let data = await contract.getExpectedReturn(
          order.inputToken,
          ETH_ADDRESS,
          order.inputAmount.toString(),
          parts,
          0
        )

        data.distribution.forEach(function(value: any, index: any) {
          if (value > 0) {
            logger.info(`${splitExchanges[index]}: ${(value * 100) / parts}%`)
          }
        })

        distributionsA = data.distribution

        data = await contract.getExpectedReturn(
          ETH_ADDRESS,
          order.outputToken,
          data.returnAmount.toString(),
          parts,
          0
        )

        data.distribution.forEach(function(value: any, index: any) {
          if (value > 0) {
            logger.info(`${splitExchanges[index]}: ${(value * 100) / parts}%`)
          }
        })

        distributionsB = data.distribution

        expectedOut = data.returnAmount
      } else {
        const data = await contract.getExpectedReturn(
          order.inputToken,
          order.outputToken,
          order.inputAmount.toString(),
          parts,
          0
        )

        data.distribution.forEach(function(value: any, index: any) {
          if (value > 0) {
            logger.info(`${splitExchanges[index]}: ${(value * 100) / parts}%`)
          }
        })

        distributionsA = data.distribution
        expectedOut = data.returnAmount
      }

      const ratio =
        expectedOut.toString() / parseInt(order.minReturn.toString())

      logger.info(`${order.inputToken} -> ${order.outputToken}`)
      logger.info(
        `Can buy ${expectedOut.toString()} / ${order.minReturn.toString()} => ${ratio}% `
      )

      if (ratio < 1) {
        return
      }

      let params = this.getOrderExecutionParams(
        order,
        handler,
        distributionsA,
        distributionsB
      )

      // Get real estimated gas
      let estimatedGas = await this.estimateGasExecution(params)
      if (!estimatedGas) {
        return
      }

      let gasPrice = await getGasPrice()
      if (gasPrice.eq(0)) {
        gasPrice = await this.base.provider.getGasPrice()
      }

      let fee = this.base.getFee(gasPrice.mul(estimatedGas)) // gasPrice

      // Build execution params with fee
      params = this.getOrderExecutionParams(
        order,
        handler,
        distributionsA,
        distributionsB,
        fee
      )

      // simulate
      await this.base.pineCore.callStatic.executeOrder(...params, {
        from: this.base.account.address,
        gasLimit: estimatedGas.add(ethers.BigNumber.from(50000)),
        gasPrice
      })

      const isOrderOpen = await this.base.existOrder(order)
      if (!isOrderOpen) {
        return undefined
      }

      logger.info(`1inch: can be executed: ${order.createdTxHash}`)

      // execute
      const tx = await this.base.pineCore.executeOrder(...params, {
        from: this.base.account.address,
        gasLimit: estimatedGas.add(ethers.BigNumber.from(50000)),
        gasPrice: gasPrice
      })

      logger.info(
        `Relayer: Filled ${order.createdTxHash} order, executedTxHash: ${tx.hash}`
      )
      return tx.hash
    } catch (e) {
      console.log(
        `Relayer: Error filling order ${order.createdTxHash}: ${
          e.error ? e.error : e.message
        }`
      )
      return undefined
    }
  }

  getOrderExecutionParams(
    order: Order,
    handler: ethers.Contract,
    distributionsA: number[],
    distributionsB: number[],
    fee = ethers.BigNumber.from(1)
  ): any[] {
    return [
      order.module,
      order.inputToken,
      order.owner,
      this.base.abiCoder.encode(
        ['address', 'uint256'],
        [order.outputToken, order.minReturn.toString()]
      ),
      order.signature,
      this.base.abiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'uint256[]', 'uint256[]'],
        [
          handler.address,
          this.base.account.address,
          fee,
          0,
          distributionsA,
          distributionsB
        ]
      )
    ]
  }

  async estimateGasExecution(params: any, gasPrice = ethers.BigNumber.from(1)) {
    try {
      return await this.base.pineCore.estimateGas.executeOrder(...params, {
        gasPrice
      })
    } catch (e) {
      logger.debug(`Could not estimate gas.Error: ${e.error}`)
      return undefined
    }
  }

  getSplitExchanges(): string[] {
    return [
      'Uniswap',
      'Kyber',
      'Bancor',
      'Oasis',
      'CurveCompound',
      'CurveUsdt',
      'CurveY',
      'CurveBinance',
      'CurveSynthetix',
      'UniswapCompound',
      'UniswapChai',
      'UniswapAave',
      'Mooniswap',
      'UniswapV2',
      'UniswapV2ETH',
      'UniswapV2DAI',
      'UniswapV2USDC',
      'CurvePax',
      'CurveRenBtc',
      'CurveTBtc',
      'DforceSwap',
      'Shellexchangers'
    ]
  }
}
