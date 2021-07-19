import { asm } from "../assembler";
import { bin } from "../bin";
import { capi } from "../capi";
import { abstract } from "../common";
import { NativePointer, pdb, StaticPointer, VoidPointer } from "../core";
import { CxxVector } from "../cxxvector";
import { SYMOPT_PUBLICS_ONLY, UNDNAME_NAME_ONLY } from "../dbghelp";
import { makefunc } from "../makefunc";
import { KeysFilter, nativeClass, NativeClass, NativeClassType, nativeField } from "../nativeclass";
import { bin64_t, bool_t, CxxString, float32_t, int16_t, int32_t, NativeType, Type, uint32_t, void_t } from "../nativetype";
import { SharedPtr } from "../sharedpointer";
import { templateName } from "../templatename";
import { Actor } from "./actor";
import { RelativeFloat } from "./blockpos";
import { CommandOrigin } from "./commandorigin";
import { JsonValue } from "./connreq";
import { AvailableCommandsPacket } from "./packets";
import { procHacker } from "./proc";
import { HasTypeId, typeid_t, type_id } from "./typeid";

export enum CommandPermissionLevel {
	Normal,
	Operator,
	Host,
	Automation,
	Admin,
}

export enum CommandCheatFlag {
    Cheat,
    NoCheat = 0x40,
    None = 0,
}

/** Putting in flag1 or flag2 are both ok, you can also combine with other flags like CommandCheatFlag.NoCheat | CommandVisibilityFlag.HiddenFromCommandBlockOrigin but combining is actually not quite useful */
export enum CommandVisibilityFlag {
    Visible,
    /** Bug: Besides from being hidden from command blocks, players cannot see it also well, but they are still able to execute */
    HiddenFromCommandBlockOrigin = 2,
    HiddenFromPlayerOrigin = 4,
    /** Still visible to console */
    Hidden = 6,
}

export enum CommandUsageFlag {
    Normal,
    Test,
    /** Any larger than 1 is hidden */
    Hidden,
    _Unknown=0x80
}

/** @deprecated **/
export const CommandFlag = CommandCheatFlag;

@nativeClass()
export class MCRESULT extends NativeClass {
    @nativeField(uint32_t)
    result:uint32_t;
}

@nativeClass(0xc0)
export class CommandSelectorBase extends NativeClass {
    private _newResults(origin:CommandOrigin):SharedPtr<CxxVector<Actor>> {
        abstract();
    }
    newResults(origin:CommandOrigin):Actor[] {
        const list = this._newResults(origin);
        const actors = list.p!.toArray();
        list.dispose();
        return actors;
    }
}
const CommandSelectorBaseCtor = procHacker.js('CommandSelectorBase::CommandSelectorBase', void_t, null, CommandSelectorBase, bool_t);
CommandSelectorBase.prototype[NativeType.dtor] = procHacker.js('CommandSelectorBase::~CommandSelectorBase', void_t, {this:CommandSelectorBase});
(CommandSelectorBase.prototype as any)._newResults = procHacker.js('CommandSelectorBase::newResults', SharedPtr.make(CxxVector.make(Actor.ref())), {this:CommandSelectorBase, structureReturn: true}, CommandOrigin);

@nativeClass()
export class ActorWildcardCommandSelector<T> extends CommandSelectorBase {

    static make<T>(type:Type<T>):NativeClassType<ActorWildcardCommandSelector<T>> {
        class ActorWildcardCommandSelectorImpl extends ActorWildcardCommandSelector<T> {
        }
        Object.defineProperty(ActorWildcardCommandSelectorImpl, 'name', {value: templateName('ActorWildcardCommandSelector', type.name)});
        ActorWildcardCommandSelectorImpl.define({});

        return ActorWildcardCommandSelectorImpl;
    }
}

export const ActorActorWildcardCommandSelector = ActorWildcardCommandSelector.make(Actor);
ActorActorWildcardCommandSelector.prototype[NativeType.ctor] = function() {
    CommandSelectorBaseCtor(this, false);
};

@nativeClass()
export class CommandRawText extends NativeClass {
    @nativeField(CxxString)
    text:CxxString;
}

@nativeClass(0x30)
export class CommandContext extends NativeClass {
    @nativeField(CxxString)
    command:CxxString;
    @nativeField(CommandOrigin.ref())
    origin:CommandOrigin;
}

export enum CommandOutputType {
    Type3 = 3, // user / server console / command block
    ScriptEngine = 4,
}

@nativeClass(null)
export class CommandOutput extends NativeClass {
    getType():CommandOutputType {
        abstract();
    }
    constructAs(type:CommandOutputType):void {
        abstract();
    }
}

@nativeClass(null)
export class CommandOutputSender extends NativeClass {
    @nativeField(VoidPointer)
    vftable:VoidPointer;
}

@nativeClass(null)
export class MinecraftCommands extends NativeClass {
    @nativeField(VoidPointer)
    vftable:VoidPointer;
    @nativeField(CommandOutputSender.ref())
    sender:CommandOutputSender;
    handleOutput(origin:CommandOrigin, output:CommandOutput):void {
        abstract();
    }
    executeCommand(ctx:SharedPtr<CommandContext>, b:boolean):MCRESULT {
        abstract();
    }
    getRegistry():CommandRegistry {
        abstract();
    }
}

export enum CommandParameterDataType { NORMAL, ENUM, SOFT_ENUM }

const parsers = new Map<Type<any>, VoidPointer>();

@nativeClass()
export class CommandParameterData extends NativeClass {
    @nativeField(typeid_t)
    tid:typeid_t<CommandRegistry>;
    @nativeField(VoidPointer)
    parser:VoidPointer; // bool (CommandRegistry::*)(void *, CommandRegistry::ParseToken const &, CommandOrigin const &, int, std::string &,std::vector<std::string> &) const;
    @nativeField(CxxString)
    name:CxxString;
    @nativeField(VoidPointer)
    desc:VoidPointer|null; // char*
    @nativeField(int32_t)
    unk56:int32_t;
    @nativeField(int32_t)
    type:CommandParameterDataType;
    @nativeField(int32_t)
    offset:int32_t;
    @nativeField(int32_t)
    flag_offset:int32_t;
    @nativeField(bool_t)
    optional:bool_t;
    @nativeField(bool_t)
    pad73:bool_t;
}

@nativeClass()
export class CommandVFTable extends NativeClass {
    @nativeField(VoidPointer)
    destructor:VoidPointer;
    @nativeField(VoidPointer)
    execute:VoidPointer|null;
}

@nativeClass()
export class Command extends NativeClass {
    @nativeField(CommandVFTable.ref())
    vftable:CommandVFTable; // 0x00
    @nativeField(int32_t)
    u1:int32_t; // 0x08
    @nativeField(VoidPointer)
    u2:VoidPointer|null; // 0x10
    @nativeField(int32_t)
    u3:int32_t; // 0x18
    @nativeField(int16_t)
    u4:int16_t; // 0x1c

    [NativeType.ctor]():void {
        this.vftable = null as any;
        this.u3 = -1;
        this.u1 = 0;
        this.u2 = null;
        this.u4 = 5;
    }

    static mandatory<CMD extends Command,
        KEY extends keyof CMD,
        KEY_ISSET extends KeysFilter<CMD, bool_t>|null>(
        this:{new():CMD},
        key:KEY,
        keyForIsSet:KEY_ISSET,
        desc?:string|null,
        type:CommandParameterDataType = CommandParameterDataType.NORMAL,
        name:string = key as string):CommandParameterData {
        const cmdclass = this as NativeClassType<any>;
        const paramType = cmdclass.typeOf(key as string);
        const offset = cmdclass.offsetOf(key as string);
        const flag_offset = keyForIsSet !== null ? cmdclass.offsetOf(keyForIsSet as string) : -1;
        return Command.manual(name, paramType, offset, flag_offset, false, desc, type);
    }
    static optional<CMD extends Command,
        KEY extends keyof CMD,
        KEY_ISSET extends KeysFilter<CMD, bool_t>|null>(
        this:{new():CMD},
        key:KEY,
        keyForIsSet:KEY_ISSET,
        desc?:string|null,
        type:CommandParameterDataType = CommandParameterDataType.NORMAL,
        name:string = key as string):CommandParameterData {
        const cmdclass = this as NativeClassType<any>;
        const paramType = cmdclass.typeOf(key as string);
        const offset = cmdclass.offsetOf(key as string);
        const flag_offset = keyForIsSet !== null ? cmdclass.offsetOf(keyForIsSet as string) : -1;
        return Command.manual(name, paramType, offset, flag_offset, true, desc, type);
    }
    static manual(
        name:string,
        paramType:Type<any>,
        offset:number,
        flag_offset:number = -1,
        optional:boolean = false,
        desc?:string|null,
        type:CommandParameterDataType = CommandParameterDataType.NORMAL):CommandParameterData {
        const param = CommandParameterData.construct();
        param.tid.id = type_id(CommandRegistry, paramType).id;
        param.parser = CommandRegistry.getParser(paramType);
        param.name = name;
        param.type = type;
        if (desc != null) {
            const ptr = new NativePointer;
            ptr.setAddressFromBuffer(asm.const_str(desc));
            param.desc = ptr;
        } else {
            param.desc = null;
        }

        param.unk56 = -1;
        param.offset = offset;
        param.flag_offset = flag_offset;
        param.optional = optional;
        param.pad73 = false;
        return param;
    }
}

export namespace Command {
    export const VFTable = CommandVFTable;
    export type VFTable = CommandVFTable;
}

export class CommandRegistry extends HasTypeId {
    registerCommand(command:string, description:string, level:CommandPermissionLevel, flag1:CommandCheatFlag|CommandVisibilityFlag, flag2:CommandUsageFlag|CommandVisibilityFlag):void {
        abstract();
    }
    registerAlias(command:string, alias:string):void {
        abstract();
    }

    /**
     * this method will destruct all parameters in params
     */
    registerOverload(name:string, commandClass:{new():Command}, params:CommandParameterData[]):void {
        const cls = commandClass as NativeClassType<Command>;
        const size = cls[NativeType.size];
        if (!size) throw Error(`${cls.name}: size is not defined`);
        const allocator = makefunc.np((returnval:StaticPointer)=>{
            const ptr = capi.malloc(size);
            const cmd = ptr.as(cls);
            cmd.construct();

            returnval.setPointer(cmd);
            return returnval;
        }, StaticPointer, null, StaticPointer);

        const sig = this.findCommand(name);
        if (sig === null) throw Error(`${name}: command not found`);

        const overload = CommandRegistry.Overload.construct();
        overload.commandVersion = bin.make64(1, 0x7fffffff);
        overload.allocator = allocator;
        overload.parameters.setFromArray(params);
        overload.u6 = -1;
        sig.overloads.push(overload);
        this.registerOverloadInternal(sig, sig.overloads.back()!);
        overload.destruct();

        for (const param of params) {
            param.destruct();
        }
    }

    registerOverloadInternal(signature:CommandRegistry.Signature, overload: CommandRegistry.Overload):void{
        abstract();
    }

    findCommand(command:string):CommandRegistry.Signature|null {
        abstract();
    }

    protected _serializeAvailableCommands(pk:AvailableCommandsPacket):AvailableCommandsPacket {
        abstract();
    }

    serializeAvailableCommands():AvailableCommandsPacket {
        const pk = AvailableCommandsPacket.create();
        this._serializeAvailableCommands(pk);
        return pk;
    }

    static getParser<T>(type:Type<T>):VoidPointer {
        const parser = parsers.get(type);
        if (parser != null) return parser;
        throw Error(`${type.symbol || type.name} parser not found`);
    }
}

export namespace CommandRegistry {
    @nativeClass(0x30)
    export class Overload extends NativeClass {
        @nativeField(bin64_t)
        commandVersion:bin64_t;
        @nativeField(VoidPointer)
        allocator:VoidPointer;
        @nativeField(CxxVector.make<CommandParameterData>(CommandParameterData))
        parameters:CxxVector<CommandParameterData>;
        @nativeField(int32_t)
        u6:int32_t;
    }

    @nativeClass(null)
    export class Signature extends NativeClass {
        @nativeField(CxxString)
        command:CxxString;
        @nativeField(CxxString)
        description:CxxString;
        @nativeField(CxxVector.make<CommandRegistry.Overload>(CommandRegistry.Overload))
        overloads:CxxVector<Overload>;
    }

    @nativeClass(null)
    export class ParseToken extends NativeClass {
    }
}

function loadParserFromPdb(types:Type<any>[]):void {
    const symbols = types.map(type=>templateName('CommandRegistry::parse', type.symbol || type.name));

    pdb.setOptions(SYMOPT_PUBLICS_ONLY); // XXX: CommandRegistry::parse<bool> does not found without it.
    const addrs = pdb.getList(pdb.coreCachePath, {}, symbols, false, UNDNAME_NAME_ONLY);
    pdb.setOptions(0);

    for (let i=0;i<symbols.length;i++) {
        const addr = addrs[symbols[i]];
        if (addr == null) continue;
        parsers.set(types[i], addr);
    }
}

const types = [
    int32_t,
    float32_t,
    bool_t,
    CxxString,
    ActorActorWildcardCommandSelector,
    RelativeFloat,
    CommandRawText,
    JsonValue
];
type_id.pdbimport(CommandRegistry, types);
loadParserFromPdb(types);

CommandOutput.prototype.getType = procHacker.js('CommandOutput::getType', int32_t, {this:CommandOutput});
CommandOutput.prototype.constructAs = procHacker.js('??0CommandOutput@@QEAA@W4CommandOutputType@@@Z', void_t, {this:CommandOutput}, int32_t);

MinecraftCommands.prototype.handleOutput = procHacker.js('MinecraftCommands::handleOutput', void_t, {this:MinecraftCommands}, CommandOrigin, CommandOutput);
// MinecraftCommands.prototype.executeCommand is defined at bdsx/command.ts
MinecraftCommands.prototype.getRegistry = procHacker.js('MinecraftCommands::getRegistry', CommandRegistry, {this: MinecraftCommands });

CommandRegistry.prototype.registerOverloadInternal = procHacker.js('CommandRegistry::registerOverloadInternal', void_t, {this:CommandRegistry}, CommandRegistry.Signature, CommandRegistry.Overload);
CommandRegistry.prototype.registerCommand = procHacker.js("CommandRegistry::registerCommand", void_t, {this:CommandRegistry}, CxxString, makefunc.Utf8, int32_t, int32_t, int32_t);
CommandRegistry.prototype.registerAlias = procHacker.js("CommandRegistry::registerAlias", void_t, {this:CommandRegistry}, CxxString, CxxString);
CommandRegistry.prototype.findCommand = procHacker.js("CommandRegistry::findCommand", CommandRegistry.Signature, {this:CommandRegistry}, CxxString);
(CommandRegistry.prototype as any)._serializeAvailableCommands = procHacker.js("CommandRegistry::serializeAvailableCommands", AvailableCommandsPacket, {this:CommandRegistry}, AvailableCommandsPacket);

'CommandRegistry::parse<AutomaticID<Dimension,int> >';
'CommandRegistry::parse<Block const * __ptr64>';
'CommandRegistry::parse<CommandFilePath>';
'CommandRegistry::parse<CommandIntegerRange>';
'CommandRegistry::parse<CommandItem>';
'CommandRegistry::parse<CommandMessage>';
'CommandRegistry::parse<CommandPosition>';
'CommandRegistry::parse<CommandPositionFloat>';
'CommandRegistry::parse<CommandRawText>';
'CommandRegistry::parse<CommandSelector<Actor> >';
'CommandRegistry::parse<CommandSelector<Player> >';
'CommandRegistry::parse<CommandWildcardInt>';
'CommandRegistry::parse<Json::Value>';
'CommandRegistry::parse<MobEffect const * __ptr64>';
'CommandRegistry::parse<std::basic_string<char,struct std::char_traits<char>,class std::allocator<char> > >';
'CommandRegistry::parse<std::unique_ptr<Command,struct std::default_delete<Command> > >';
'CommandRegistry::parse<AgentCommand::Mode>';
'CommandRegistry::parse<AgentCommands::CollectCommand::CollectionSpecification>';
'CommandRegistry::parse<AgentCommands::Direction>';
'CommandRegistry::parse<AnimationMode>';
'CommandRegistry::parse<AreaType>';
'CommandRegistry::parse<BlockSlot>';
'CommandRegistry::parse<CodeBuilderCommand::Action>';
'CommandRegistry::parse<CommandOperator>';
'CommandRegistry::parse<Enchant::Type>';
'CommandRegistry::parse<EquipmentSlot>';
'CommandRegistry::parse<GameType>';
'CommandRegistry::parse<Mirror>';
'CommandRegistry::parse<ObjectiveSortOrder>';
'CommandRegistry::parse<Rotation>';
'CommandRegistry::parse<ActorDefinitionIdentifier const * __ptr64>';
