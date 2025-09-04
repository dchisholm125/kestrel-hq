import { expect } from 'chai'
import * as ethers from 'ethers'
import fs from 'fs'
import path from 'path'
import { ENV } from '../../src/config'

describe('BatchExecutor integration (deploy + execute)', function () {
  this.timeout(20000)
  let provider: ethers.JsonRpcProvider
  let wallet: ethers.Wallet
  let batchAddress: string
  let mockAddress: string
  let batchAbi: any
  let mockAbi: any

  before(async () => {
    provider = new ethers.JsonRpcProvider(ENV.RPC_URL)
    const pk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    wallet = new ethers.Wallet(pk, provider)

    // Read artifacts
    const batchArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../../build/BatchExecutor.json'), 'utf8'))
    const mockArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../../build/MockTarget.json'), 'utf8'))
    batchAbi = batchArtifact.abi
    mockAbi = mockArtifact.abi

    // Deploy BatchExecutor
    const batchFactory = new ethers.ContractFactory(batchAbi, batchArtifact.bytecode, wallet)
    const batch = await batchFactory.deploy()
    await batch.waitForDeployment()
    batchAddress = await batch.getAddress()

    // Deploy MockTarget
    const mockFactory = new ethers.ContractFactory(mockAbi, mockArtifact.bytecode, wallet)
    const mock = await mockFactory.deploy()
    await mock.waitForDeployment()
    mockAddress = await mock.getAddress()
  })

  it('executes a batch of calls successfully', async () => {
    const mock = new ethers.Contract(mockAddress, mockAbi, wallet)
    const batch = new ethers.Contract(batchAddress, batchAbi, wallet)

    const incData = mock.interface.encodeFunctionData('increment')
    const setValueData = mock.interface.encodeFunctionData('setValue', [42])
    const toggleData = mock.interface.encodeFunctionData('toggle')

    const calls = [
      { target: mockAddress, value: 0, data: incData },
      { target: mockAddress, value: 0, data: setValueData },
      { target: mockAddress, value: 0, data: toggleData }
    ]

    const tx = await batch.executeBatch(calls)
    const receipt = await tx.wait()
    expect(receipt?.status).to.equal(1)

    expect(await mock.counter()).to.equal(1n)
    expect(await mock.lastValue()).to.equal(42n)
    expect(await mock.flag()).to.equal(true)
  })

  it('reverts entire batch if one call fails', async () => {
    const mock = new ethers.Contract(mockAddress, mockAbi, wallet)
    const batch = new ethers.Contract(batchAddress, batchAbi, wallet)

    const good = mock.interface.encodeFunctionData('increment')
    const bad = mock.interface.encodeFunctionData('willRevert')

    const calls = [
      { target: mockAddress, value: 0, data: good },
      { target: mockAddress, value: 0, data: bad },
      { target: mockAddress, value: 0, data: good }
    ]

    let reverted = false
    try {
      await batch.executeBatch(calls)
    } catch (e) {
      reverted = true
    }
    expect(reverted).to.equal(true)
  })
})
