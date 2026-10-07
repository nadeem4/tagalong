import {
  CHAIR_SIZE,
  DESK_SIZE,
  DOOR,
  FLOOR,
  PLANTS,
  ROOMS,
  TABLE_SIZE,
  WINDOW_SIZE,
  WINDOW_XS,
  cursorAbove,
  deskLayout,
  monitorAt,
  plateAt,
  roomFurniture,
  seatAt,
} from './layout';
import type { Room } from './layout';
import type { OfficeMember } from './member';
import { PixelSprite } from './pixel-sprite';
import { CURSOR, PLANT } from './sprites/characters';
import { officeTokens as t } from './tokens';

export interface OfficeFloorProps {
  members: readonly OfficeMember[];
  selectedId: string | null;
}

/**
 * The office seen from above: desks on the left, glass meeting rooms on the right. Every
 * position comes from the layout module; this component only draws.
 */
export function OfficeFloor({ members, selectedId }: OfficeFloorProps) {
  const desks = deskLayout(members.length);
  const seated = desks.map((desk, index) => ({ desk, member: members[index] }));
  const selectedDesk = seated.find(({ member }) => member?.pet.id === selectedId)?.desk;
  const cursor = selectedDesk === undefined ? undefined : cursorAbove(seatAt(selectedDesk));

  return (
    <section
      aria-label="Office floor"
      style={{
        width: FLOOR.width,
        flex: 'none',
        overflowX: 'hidden',
        overflowY: 'auto',
        background: t.color.floor,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: FLOOR.width,
          height: FLOOR.height,
          overflow: 'hidden',
          backgroundImage: `linear-gradient(${t.color.floorGrid} 2px, transparent 2px), linear-gradient(90deg, ${t.color.floorGrid} 2px, transparent 2px)`,
          backgroundSize: '32px 32px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: FLOOR.width,
            height: FLOOR.wallHeight,
            background: t.color.wall,
          }}
        />
        {WINDOW_XS.map((x) => (
          <div
            key={x}
            style={{
              position: 'absolute',
              left: x,
              top: WINDOW_SIZE.y,
              width: WINDOW_SIZE.width,
              height: WINDOW_SIZE.height,
              background: t.color.window,
              boxShadow: `inset 0 -4px 0 ${t.color.windowSill}`,
            }}
          />
        ))}

        {ROOMS.map((room) => (
          <MeetingRoom key={room.name} room={room} />
        ))}

        {PLANTS.map((plant) => (
          <PixelSprite
            key={`${plant.x},${plant.y}`}
            sprite={PLANT}
            scale={t.spriteScale.plant}
            style={{ position: 'absolute', left: plant.x, top: plant.y }}
          />
        ))}

        {seated.map(({ desk, member }, index) => {
          if (member === undefined) return null;
          const seat = seatAt(desk);
          return (
            <PixelSprite
              key={member.pet.id}
              sprite={member.character.sprite}
              scale={t.spriteScale.floor}
              className="office-bob"
              style={{
                position: 'absolute',
                left: seat.x,
                top: seat.y,
                animationDelay: `${index * t.timing.bobStagger}s`,
              }}
            />
          );
        })}

        {seated.map(({ desk, member }) => {
          if (member === undefined) return null;
          const monitor = monitorAt(desk);
          const plate = plateAt(desk);
          const lit = member.status === 'working';
          return (
            <div key={member.pet.id}>
              <div
                data-testid={`monitor-${member.pet.id}`}
                data-lit={lit}
                style={{
                  position: 'absolute',
                  left: monitor.x,
                  top: monitor.y,
                  width: monitor.width,
                  height: monitor.height,
                  boxSizing: 'border-box',
                  border: `2px solid ${t.color.monitor}`,
                  background: lit ? t.color.screenOn : t.color.screenOff,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: desk.x,
                  top: desk.y,
                  width: DESK_SIZE.width,
                  height: DESK_SIZE.height,
                  background: t.color.desk,
                  border: `2px solid ${t.color.furnitureLine}`,
                  boxShadow: `0 5px 0 ${t.color.furnitureShadow}`,
                }}
              />
              <div
                className="office-px"
                style={{
                  position: 'absolute',
                  left: plate.x,
                  top: plate.y,
                  width: DESK_SIZE.plateWidth,
                  textAlign: 'center',
                  fontSize: t.fontSize.min,
                  letterSpacing: t.letterSpacing.pixel,
                  color: t.color.plate,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {member.pet.name.toUpperCase()}
              </div>
            </div>
          );
        })}

        {cursor !== undefined && selectedId !== null && (
          <span
            data-testid="office-cursor"
            data-pet-id={selectedId}
            className="office-hop"
            style={{ position: 'absolute', left: cursor.x, top: cursor.y }}
          >
            <PixelSprite sprite={CURSOR} scale={t.spriteScale.cursor} />
          </span>
        )}
      </div>
    </section>
  );
}

/** A glass meeting room. Meetings arrive in a later phase, so every room is free. */
function MeetingRoom({ room }: { room: Room }) {
  const { table, chairs } = roomFurniture(room);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: room.x,
          top: room.y,
          width: room.width,
          height: room.height,
          boxSizing: 'border-box',
          border: `4px solid ${t.color.roomGlass}`,
          background: t.color.roomFill,
          boxShadow: `inset 0 0 0 2px ${t.color.roomShine}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: room.x - 2,
          top: room.y + room.height - DOOR.fromBottom,
          width: DOOR.width,
          height: DOOR.height,
          background: t.color.floor,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: room.x + 14,
          top: room.y + 12,
          display: 'flex',
          alignItems: 'center',
          gap: t.space.md,
        }}
      >
        <span
          className="office-px"
          style={{
            fontSize: t.fontSize.roomName,
            fontWeight: t.fontWeight.bold,
            letterSpacing: t.letterSpacing.pixel,
            color: t.color.roomLabel,
          }}
        >
          {room.name}
        </span>
        <span
          style={{
            fontSize: t.fontSize.min,
            fontWeight: t.fontWeight.semibold,
            padding: `${t.space.xxs}px ${t.space.md}px`,
            borderRadius: t.radius.chip,
            background: t.color.chipFree,
            color: t.color.chipFreeInk,
          }}
        >
          Free
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: table.x,
          top: table.y,
          width: TABLE_SIZE.width,
          height: TABLE_SIZE.height,
          background: t.color.table,
          border: `2px solid ${t.color.furnitureLine}`,
          boxShadow: `0 4px 0 ${t.color.furnitureShadow}`,
        }}
      />
      {chairs.map((chair) => (
        <div
          key={`${chair.x},${chair.y}`}
          style={{
            position: 'absolute',
            left: chair.x,
            top: chair.y,
            width: CHAIR_SIZE.width,
            height: CHAIR_SIZE.height,
            background: t.color.chair,
            boxShadow: `0 3px 0 ${t.color.chairShadow}`,
          }}
        />
      ))}
    </>
  );
}
